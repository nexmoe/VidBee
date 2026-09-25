import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { ASR_TIER_IDS, type AsrTierId, asrTierInfo } from './asr-tiers'
import { fetchFirstOk, modelDownloadUrls, preferChinaMirrors } from './download-mirrors'
import { catalogFor, MODEL_CATALOG, modelVersion } from './model-catalog'
import type {
  AsrTierStatus,
  ModelDownloadProgress,
  ModelFileSpec,
  ModelGroup,
  ModelStatus
} from './types'

const execFileAsync = promisify(execFile)

export interface ModelManagerOptions {
  modelsDir: string
  catalog?: readonly ModelFileSpec[]
  fetchImpl?: typeof fetch
  /** Called at download time so a settings change applies to the next file. */
  preferChina?: boolean | (() => boolean)
  /** Override candidate URLs (tests). Production uses ModelScope + GitHub mirrors. */
  resolveUrls?: (spec: ModelFileSpec) => readonly string[]
  /** Per-URL header timeout so a blocked GitHub host does not sit at 0%. */
  attemptTimeoutMs?: number
}

export interface EnsureReadyOptions {
  groups?: readonly ModelGroup[]
  tiers?: readonly AsrTierId[]
}

const presentBytes = (path: string): { present: boolean; bytes: number } => {
  if (!existsSync(path)) {
    return { present: false, bytes: 0 }
  }
  const stats = statSync(path)
  if (stats.isDirectory()) {
    const children = readdirSync(path)
    return { present: children.length > 0, bytes: children.length }
  }
  return { present: stats.size > 0, bytes: stats.size }
}

/**
 * Per-process staging file so the desktop host and ASR worker can download
 * the same model without sharing one `.part` stream.
 *
 * @param dest Final on-disk model path.
 */
export const modelPartPath = (dest: string): string => `${dest}.part.${process.pid}`

/**
 * Delete leftover staging files for a model dest.
 *
 * @param dest Final on-disk model path.
 */
export const removeModelPartFiles = (dest: string): void => {
  rmSync(`${dest}.part`, { force: true })
  rmSync(modelPartPath(dest), { force: true })
}

/**
 * Move a finished download into place. Another process may already have
 * published the same file; that is success, not a missing-file error.
 *
 * @param tmp Staging `.part` path for this process.
 * @param dest Final on-disk model path.
 */
export const finalizeModelFile = (tmp: string, dest: string): void => {
  if (presentBytes(dest).present) {
    if (existsSync(tmp)) {
      rmSync(tmp, { force: true })
    }
    return
  }
  try {
    renameSync(tmp, dest)
  } catch (error) {
    if (presentBytes(dest).present) {
      if (existsSync(tmp)) {
        rmSync(tmp, { force: true })
      }
      return
    }
    throw error
  }
}

const isArchiveUrl = (url: string): boolean => /\.(tar\.bz2|tar\.gz|tgz|tbz2)$/i.test(url)

/**
 * Archive file name from a GitHub or proxy URL.
 */
const archiveFileName = (url: string): string => {
  try {
    return basename(new URL(url).pathname)
  } catch {
    return basename(url)
  }
}

export const MODEL_DOWNLOAD_CANCELLED = 'download cancelled'

/**
 * True when a model fetch stopped because the user cancelled it.
 */
export const isModelDownloadCancelled = (error: unknown): boolean => {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  return name === 'AbortError' || /download cancelled|operation was aborted/i.test(message)
}

/**
 * Throw a stable cancelled error when the abort signal has fired.
 */
const throwIfAborted = (signal?: AbortSignal, tier?: AsrTierId): void => {
  if (!signal?.aborted) {
    return
  }
  throw Object.assign(
    new Error(tier ? `${MODEL_DOWNLOAD_CANCELLED}: ${tier}` : MODEL_DOWNLOAD_CANCELLED),
    {
      name: 'AbortError'
    }
  )
}

export class ModelManager {
  readonly modelsDir: string
  private readonly catalog: readonly ModelFileSpec[]
  private readonly fetchImpl: typeof fetch
  private readonly preferChinaOption?: boolean | (() => boolean)
  private readonly resolveUrls?: (spec: ModelFileSpec) => readonly string[]
  private readonly attemptTimeoutMs: number
  private readonly inflight = new Map<string, Promise<void>>()
  private readonly downloadProgressByKey = new Map<string, ModelDownloadProgress>()
  private readonly ensureCounts = new Map<AsrTierId, number>()
  private readonly abortByTier = new Map<AsrTierId, AbortController>()
  private readonly progressListeners = new Set<(status: ModelStatus) => void>()
  private lastProgressEmitAt = 0
  private activeTiers: readonly AsrTierId[] = []

  constructor(opts: ModelManagerOptions) {
    this.modelsDir = opts.modelsDir
    this.catalog = opts.catalog ?? MODEL_CATALOG
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.preferChinaOption = opts.preferChina
    this.resolveUrls = opts.resolveUrls
    this.attemptTimeoutMs = opts.attemptTimeoutMs ?? 15_000
    mkdirSync(this.modelsDir, { recursive: true })
  }

  /**
   * Listen for download progress. Returns an unsubscribe function.
   *
   * @param listener Called with occupancy status after progress changes.
   */
  subscribe(listener: (status: ModelStatus) => void): () => void {
    this.progressListeners.add(listener)
    return () => {
      this.progressListeners.delete(listener)
    }
  }

  status(groups?: readonly ModelGroup[], tiers?: readonly AsrTierId[]): ModelStatus {
    const occupancy = !(groups || tiers)
    const wanted = occupancy ? this.catalog : this.wantedSpecs(groups, tiers)
    const files = wanted.map((spec) => {
      const path = this.pathFor(spec)
      const info = presentBytes(path)
      return {
        id: spec.id,
        present: info.present,
        path,
        bytes: info.bytes
      }
    })
    const readySet = occupancy ? this.wantedSpecs(['vad', 'speaker', 'asr'], ['minimal']) : wanted
    const ready = readySet.every((spec) => {
      const info = presentBytes(this.pathFor(spec))
      return info.present && info.bytes > 0
    })
    const downloads = [...this.downloadProgressByKey.values()]
    return {
      ready,
      version: modelVersion,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      files,
      tiers: this.tierStatuses(),
      downloading: downloads[0] ?? null,
      downloads
    }
  }

  pathFor(spec: Pick<ModelFileSpec, 'fileName'>): string {
    return join(this.modelsDir, spec.fileName)
  }

  pathByRole(role: ModelFileSpec['role'], tier?: AsrTierId): string | null {
    const wantedTier = tier ?? this.activeTiers[0]
    const spec = this.catalog.find((item) => {
      if (item.role !== role) {
        return false
      }
      if (item.tier && wantedTier && item.tier !== wantedTier) {
        return false
      }
      return true
    })
    if (!spec) {
      return null
    }
    const path = this.pathFor(spec)
    return presentBytes(path).present ? path : null
  }

  /**
   * Resolve a catalog entry by id when more than one file shares a role.
   *
   * @param id Catalog id such as `speaker-embedding`.
   */
  pathById(id: string): string | null {
    const spec = this.catalog.find((item) => item.id === id)
    if (!spec) {
      return null
    }
    const path = this.pathFor(spec)
    return presentBytes(path).present ? path : null
  }

  async ensureReady(opts?: EnsureReadyOptions): Promise<ModelStatus> {
    if (opts?.tiers) {
      this.activeTiers = opts.tiers
    }
    const current = this.status(opts?.groups, opts?.tiers)
    if (current.ready) {
      return current
    }
    const key = `${(opts?.groups ?? ['vad', 'speaker', 'asr']).join(',')}:${(opts?.tiers ?? []).join(',')}`
    const existing = this.inflight.get(key)
    if (existing) {
      await existing
      return this.status(opts?.groups, opts?.tiers)
    }
    this.beginTiers(opts?.tiers)
    const controller = new AbortController()
    for (const tier of opts?.tiers ?? []) {
      this.abortByTier.set(tier, controller)
    }
    const pending = this.downloadMissing(opts?.groups, opts?.tiers, controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted || isModelDownloadCancelled(error)) {
          for (const tier of opts?.tiers ?? []) {
            this.purgeTierFiles(tier)
          }
          throwIfAborted(controller.signal, opts?.tiers?.[0])
        }
        throw error
      })
      .finally(() => {
        this.inflight.delete(key)
        this.endTiers(opts?.tiers)
        for (const tier of opts?.tiers ?? []) {
          if (this.abortByTier.get(tier) === controller) {
            this.abortByTier.delete(tier)
          }
        }
      })
    this.inflight.set(key, pending)
    await pending
    const next = this.status(opts?.groups, opts?.tiers)
    this.emitProgress(true)
    if (!next.ready) {
      throwIfAborted(controller.signal, opts?.tiers?.[0])
      throw new Error('model not ready after download')
    }
    return next
  }

  /**
   * Same as ensureReady, but a user cancel returns current status instead of throwing.
   */
  async ensureReadyAllowCancel(opts?: EnsureReadyOptions): Promise<ModelStatus> {
    try {
      return await this.ensureReady(opts)
    } catch (error) {
      if (isModelDownloadCancelled(error)) {
        return this.status(opts?.groups, opts?.tiers)
      }
      throw error
    }
  }

  async redownload(): Promise<ModelStatus> {
    for (const spec of this.catalog) {
      const path = this.pathFor(spec)
      if (existsSync(path)) {
        rmSync(path, { recursive: true, force: true })
      }
    }
    const downloads = join(this.modelsDir, '.downloads')
    if (existsSync(downloads)) {
      rmSync(downloads, { recursive: true, force: true })
    }
    return this.ensureReady()
  }

  /**
   * Delete on-disk files for one ASR model. Shared VAD/speaker files stay.
   */
  removeTier(tier: AsrTierId): ModelStatus {
    if ((this.ensureCounts.get(tier) ?? 0) > 0) {
      throw new Error(`cannot delete ${tier} while it is downloading`)
    }
    if (this.wantedSpecs(['asr'], [tier]).length === 0) {
      throw new Error(`unknown ASR tier: ${tier}`)
    }
    this.purgeTierFiles(tier)
    return this.status()
  }

  /**
   * Abort an in-flight model download. Partial files are removed.
   */
  cancelDownload(tier: AsrTierId): ModelStatus {
    const controller = this.abortByTier.get(tier)
    if (controller && !controller.signal.aborted) {
      controller.abort()
    }
    this.emitProgress(true)
    return this.status()
  }

  /**
   * Remove ASR files, extract dirs, and cached archives for one model.
   */
  private purgeTierFiles(tier: AsrTierId): void {
    const specs = this.wantedSpecs(['asr'], [tier])
    const roots = new Set<string>()
    const archives = new Set<string>()
    for (const spec of specs) {
      const dest = this.pathFor(spec)
      if (existsSync(dest)) {
        rmSync(dest, { recursive: true, force: true })
      }
      removeModelPartFiles(dest)
      roots.add(this.modelRootFor(spec))
      if (isArchiveUrl(spec.url)) {
        archives.add(spec.url)
      }
    }
    for (const root of roots) {
      if (root === this.modelsDir || !existsSync(root)) {
        continue
      }
      rmSync(root, { recursive: true, force: true })
    }
    const cacheDir = join(this.modelsDir, '.downloads')
    for (const url of archives) {
      const archivePath = join(cacheDir, basename(new URL(url).pathname))
      for (const leftover of [archivePath, `${archivePath}.extracted`]) {
        if (existsSync(leftover)) {
          rmSync(leftover, { force: true })
        }
      }
      removeModelPartFiles(archivePath)
    }
  }

  /**
   * Track an in-flight ensureReady so delete can refuse a busy model.
   */
  private beginTiers(tiers?: readonly AsrTierId[]): void {
    for (const tier of tiers ?? []) {
      this.ensureCounts.set(tier, (this.ensureCounts.get(tier) ?? 0) + 1)
    }
  }

  /**
   * Drop the matching ensureReady refcount when a download batch finishes.
   */
  private endTiers(tiers?: readonly AsrTierId[]): void {
    for (const tier of tiers ?? []) {
      const next = (this.ensureCounts.get(tier) ?? 1) - 1
      if (next <= 0) {
        this.ensureCounts.delete(tier)
      } else {
        this.ensureCounts.set(tier, next)
      }
    }
  }

  /**
   * Top-level path to remove for a catalog file (model directory or the file).
   */
  private modelRootFor(spec: ModelFileSpec): string {
    const parts = spec.fileName.split(/[/\\]/).filter(Boolean)
    if (parts.length <= 1) {
      return this.pathFor(spec)
    }
    return join(this.modelsDir, parts[0] ?? spec.fileName)
  }

  private wantedSpecs(
    groups?: readonly ModelGroup[],
    tiers?: readonly AsrTierId[]
  ): readonly ModelFileSpec[] {
    const source = this.catalog === MODEL_CATALOG ? catalogFor({ groups, tiers }) : this.catalog
    if (this.catalog !== MODEL_CATALOG) {
      return source.filter((spec) => {
        if (groups && groups.length > 0 && !groups.includes(spec.group)) {
          return false
        }
        if (spec.tier && tiers && tiers.length > 0 && !tiers.includes(spec.tier)) {
          return false
        }
        if (spec.tier && (!tiers || tiers.length === 0)) {
          return false
        }
        return true
      })
    }
    return source
  }

  private tierStatuses(): AsrTierStatus[] {
    return ASR_TIER_IDS.map((id) => {
      const specs = catalogFor({ groups: ['asr'], tiers: [id] })
      const files = specs.map((spec) => presentBytes(this.pathFor(spec)))
      const info = asrTierInfo(id)
      return {
        id,
        family: info.family,
        ready: files.length > 0 && files.every((file) => file.present && file.bytes > 0),
        bytes: files.reduce((sum, file) => sum + file.bytes, 0),
        qualityRank: info.qualityRank
      }
    })
  }

  private async downloadMissing(
    groups?: readonly ModelGroup[],
    tiers?: readonly AsrTierId[],
    signal?: AbortSignal
  ): Promise<void> {
    mkdirSync(this.modelsDir, { recursive: true })
    for (const spec of this.wantedSpecs(groups, tiers)) {
      throwIfAborted(signal, spec.tier ?? tiers?.[0])
      const dest = this.pathFor(spec)
      if (presentBytes(dest).present) {
        continue
      }
      await this.installSpec(spec, spec.tier ? signal : undefined)
    }
  }

  private async installSpec(spec: ModelFileSpec, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal, spec.tier)
    const dest = this.pathFor(spec)
    const sha256 = await this.checksumFor(spec)
    const candidates = this.urlsFor(spec)
    let lastError: unknown = new Error(`no download URLs for ${spec.id}`)
    for (const url of candidates) {
      throwIfAborted(signal, spec.tier)
      if (presentBytes(dest).present) {
        return
      }
      try {
        if (isArchiveUrl(url)) {
          await this.installArchive({ ...spec, url }, signal)
        } else {
          await this.downloadUrl(url, dest, sha256, spec.tier, signal)
        }
        if (presentBytes(dest).present) {
          return
        }
        lastError = new Error(`download of ${url} did not produce ${spec.fileName}`)
      } catch (error) {
        if (presentBytes(dest).present) {
          return
        }
        throwIfAborted(signal, spec.tier)
        lastError = error
      }
    }
    if (presentBytes(dest).present) {
      return
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  /** Read a file's checksum from its pinned publisher manifest before downloading it. */
  private async checksumFor(spec: ModelFileSpec): Promise<string | undefined> {
    if (!spec.checksumManifest) {
      return spec.sha256
    }
    const manifestSpec = this.catalog.find((item) => item.fileName === spec.checksumManifest)
    if (!manifestSpec?.sha256) {
      throw new Error(`missing pinned checksum manifest for ${spec.id}`)
    }
    const contents = await readFile(this.pathFor(manifestSpec))
    if (createHash('sha256').update(contents).digest('hex') !== manifestSpec.sha256) {
      throw new Error(`model checksum mismatch for ${manifestSpec.url}`)
    }
    const manifest = JSON.parse(contents.toString('utf8')) as {
      files?: { path?: unknown; sha256?: unknown }[]
    } | null
    const entry = Array.isArray(manifest?.files)
      ? manifest.files.find((file) => file?.path === basename(spec.fileName))
      : undefined
    if (typeof entry?.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`missing SHA256 in ${manifestSpec.fileName} for ${spec.id}`)
    }
    return entry.sha256
  }

  /**
   * Candidate URLs for one catalog file: ModelScope, GitHub, then proxies.
   */
  private urlsFor(spec: ModelFileSpec): readonly string[] {
    if (this.resolveUrls) {
      return this.resolveUrls(spec)
    }
    return modelDownloadUrls(spec, this.preferChinaNow())
  }

  /**
   * Read the latest China-mirror preference (settings can change mid-session).
   */
  private preferChinaNow(): boolean {
    if (typeof this.preferChinaOption === 'function') {
      return this.preferChinaOption()
    }
    if (typeof this.preferChinaOption === 'boolean') {
      return this.preferChinaOption
    }
    return preferChinaMirrors()
  }

  private async installArchive(spec: ModelFileSpec, signal?: AbortSignal): Promise<void> {
    const lockKey = `archive:${archiveFileName(spec.url)}`
    const existing = this.inflight.get(lockKey)
    if (existing) {
      await existing
      throwIfAborted(signal, spec.tier)
      return
    }
    const work = this.downloadAndExtractArchive(spec, signal).finally(() => {
      this.inflight.delete(lockKey)
    })
    this.inflight.set(lockKey, work)
    await work
  }

  private async downloadAndExtractArchive(
    spec: ModelFileSpec,
    signal?: AbortSignal
  ): Promise<void> {
    const url = spec.url
    const cacheDir = join(this.modelsDir, '.downloads')
    mkdirSync(cacheDir, { recursive: true })
    const archivePath = join(cacheDir, basename(new URL(url).pathname))
    const marker = `${archivePath}.extracted`
    const expected = await this.remoteContentLength(url, signal)
    const local = existsSync(archivePath) ? statSync(archivePath).size : 0
    const complete = local > 0 && (expected == null || local >= expected)
    if (!complete) {
      if (existsSync(marker)) {
        rmSync(marker, { force: true })
      }
      await this.downloadUrl(url, archivePath, undefined, spec.tier, signal)
    }
    throwIfAborted(signal, spec.tier)
    if (existsSync(marker)) {
      return
    }
    await execFileAsync(
      'tar',
      ['-xjf', archivePath, '-C', this.modelsDir],
      signal ? { signal } : {}
    )
    throwIfAborted(signal, spec.tier)
    this.pruneWhisperFp32(url)
    writeFileSync(marker, 'ok')
  }

  private pruneWhisperFp32(url: string): void {
    const name = basename(new URL(url).pathname)
    if (!name.includes('whisper')) {
      return
    }
    const dirName = name.replace(/\.tar\.bz2$/i, '')
    const dir = join(this.modelsDir, dirName)
    if (!existsSync(dir)) {
      return
    }
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith('.onnx') && !entry.includes('.int8.')) {
        rmSync(join(dir, entry), { force: true })
      }
    }
  }

  private async remoteContentLength(url: string, signal?: AbortSignal): Promise<number | null> {
    try {
      const { response } = await fetchFirstOk(
        [url],
        this.fetchImpl,
        signal ? { method: 'HEAD', signal } : { method: 'HEAD' },
        this.attemptTimeoutMs
      )
      const raw = response.headers.get('content-length')
      const size = raw ? Number(raw) : Number.NaN
      return Number.isFinite(size) && size > 0 ? size : null
    } catch (error) {
      throwIfAborted(signal)
      if (isModelDownloadCancelled(error)) {
        throw error
      }
      return null
    }
  }

  /**
   * Deduplicate writes to the same dest so two models can share VAD/speaker files.
   */
  private async downloadUrl(
    url: string,
    dest: string,
    sha256?: string,
    tier?: AsrTierId,
    signal?: AbortSignal
  ): Promise<void> {
    throwIfAborted(signal, tier)
    const lockKey = `file:${dest}`
    const existing = this.inflight.get(lockKey)
    if (existing) {
      await existing
      throwIfAborted(signal, tier)
      return
    }
    if (presentBytes(dest).present) {
      return
    }
    const work = this.downloadUrlUnlocked(url, dest, sha256, tier, signal).finally(() => {
      this.inflight.delete(lockKey)
    })
    this.inflight.set(lockKey, work)
    await work
  }

  /**
   * Stream one URL to disk and record per-file progress for concurrent transfers.
   */
  private async downloadUrlUnlocked(
    url: string,
    dest: string,
    sha256?: string,
    tier?: AsrTierId,
    signal?: AbortSignal
  ): Promise<void> {
    throwIfAborted(signal, tier)
    const { response, url: usedUrl } = await fetchFirstOk(
      [url],
      this.fetchImpl,
      signal ? { signal } : undefined,
      this.attemptTimeoutMs
    )
    if (!(response.ok && response.body)) {
      throw new Error(`network: model download failed for ${usedUrl} (${response.status})`)
    }
    const tmp = modelPartPath(dest)
    mkdirSync(dirname(dest), { recursive: true })
    const totalRaw = response.headers.get('content-length')
    const total = totalRaw ? Number(totalRaw) : Number.NaN
    const knownTotal = Number.isFinite(total) && total > 0 ? total : null
    this.downloadProgressByKey.set(dest, { url: usedUrl, received: 0, total: knownTotal, tier })
    this.emitProgress(true)
    let received = 0
    const hash = sha256 ? createHash('sha256') : undefined
    const counter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        received += chunk.length
        hash?.update(chunk)
        this.downloadProgressByKey.set(dest, { url: usedUrl, received, total: knownTotal, tier })
        this.emitProgress()
        callback(null, chunk)
      }
    })
    try {
      await pipeline(
        Readable.fromWeb(response.body as never),
        counter,
        createWriteStream(tmp),
        signal ? { signal } : {}
      )
    } catch (error) {
      if (existsSync(tmp)) {
        rmSync(tmp, { force: true })
      }
      throwIfAborted(signal, tier)
      throw error
    } finally {
      this.downloadProgressByKey.delete(dest)
      this.emitProgress(true)
    }
    throwIfAborted(signal, tier)
    if (presentBytes(dest).present) {
      if (existsSync(tmp)) {
        rmSync(tmp, { force: true })
      }
      return
    }
    if (hash && hash.digest('hex') !== sha256) {
      rmSync(tmp, { force: true })
      throw new Error(`model checksum mismatch for ${url}`)
    }
    finalizeModelFile(tmp, dest)
  }

  /**
   * Notify listeners of download progress, throttled unless `force` is set.
   *
   * @param force Emit even if the throttle window has not elapsed.
   */
  private emitProgress(force = false): void {
    if (this.progressListeners.size === 0) {
      return
    }
    const now = Date.now()
    if (!force && now - this.lastProgressEmitAt < 200) {
      return
    }
    this.lastProgressEmitAt = now
    const status = this.status()
    for (const listener of this.progressListeners) {
      listener(status)
    }
  }
}
