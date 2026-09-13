import { createHash, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createReadStream, createWriteStream, type Stats } from 'node:fs'
import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { YtDlpKernelStatus } from '@shared/types'
import { z } from 'zod'
import {
  compareYtDlpVersions,
  getRetryDelayMs,
  getYtDlpReleaseAssetName,
  resolveKernelRelativePath
} from './ytdlp-kernel-model'

const VERSION_PROBE_TIMEOUT_MS = 30_000
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000
const SUCCESS_INTERVAL_MS = 24 * 60 * 60 * 1000
const SUCCESS_JITTER_MS = 30 * 60 * 1000

const kernelComponentSchema = z.object({
  relativePath: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative().optional(),
  version: z.string().min(1)
})

const kernelBundleSchema = z.object({
  id: z.string().min(1),
  ytDlp: kernelComponentSchema
})

const kernelPersistentStateSchema = z.object({
  active: kernelBundleSchema,
  failureCount: z.number().int().nonnegative(),
  nextCheckAt: z.number().nonnegative(),
  previous: kernelBundleSchema.nullable(),
  schemaVersion: z.literal(2)
})

export type KernelPersistentState = z.infer<typeof kernelPersistentStateSchema>

export interface KernelCommandResult {
  stdout: string
  stderr: string
}

export interface KernelCommandOptions {
  signal?: AbortSignal
  timeoutMs: number
}

export type KernelCommandRunner = (
  executable: string,
  args: string[],
  options: KernelCommandOptions
) => Promise<KernelCommandResult>

interface KernelActivation {
  jsRuntimePath: string
  ytDlpPath: string
}

interface KernelLogger {
  error: (message: string) => void
  info: (message: string) => void
  warn: (message: string) => void
}

export interface YtDlpKernelServiceOptions {
  activate: (paths: KernelActivation) => void
  bundledNodePath: string
  bundledYtDlpPath: string
  fetch: typeof fetch
  kernelRoot: string
  logger?: KernelLogger
  now?: () => number
  platform: string
  random?: () => number
  runCommand: KernelCommandRunner
}

const silentLogger: KernelLogger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined
}

/**
 * Convert an unknown kernel failure into a user-copyable string.
 */
function formatKernelError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack?.trim() || error.message
  }
  return String(error)
}

/**
 * Build the renderer-visible diagnostic for a fatal kernel failure.
 */
function buildUnavailableError(
  options: YtDlpKernelServiceOptions,
  bundledError: string,
  managedError: string | null
): string {
  const lines = [
    `Platform: ${options.platform}`,
    `Kernel root: ${options.kernelRoot}`,
    `Bundled yt-dlp: ${options.bundledYtDlpPath}`,
    `Bundled Node: ${options.bundledNodePath}`,
    ''
  ]
  if (managedError) {
    lines.push('Managed preparation failed:', managedError, '')
  }
  lines.push('Bundled engine fallback failed:', bundledError)
  return lines.join('\n')
}

/**
 * Return the initial renderer-visible kernel status.
 */
function createInitialStatus(): YtDlpKernelStatus {
  return {
    error: null,
    nodeVersion: null,
    preparationStep: 'copying',
    progress: 0,
    ready: false,
    source: null,
    state: 'preparing',
    ytDlpVersion: null
  }
}

/**
 * Create a transform that reports copied bytes without buffering the binary.
 */
function createProgressTransform(onBytes: (bytes: number) => void): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      onBytes(chunk.length)
      callback(null, chunk)
    }
  })
}

/**
 * Copy a binary while reporting byte-level progress.
 */
async function copyFileWithProgress(
  sourcePath: string,
  destinationPath: string,
  onBytes: (bytes: number) => void
): Promise<void> {
  await pipeline(
    createReadStream(sourcePath),
    createProgressTransform(onBytes),
    createWriteStream(destinationPath)
  )
}

/**
 * Hash a file without loading the complete executable into memory.
 */
async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

/**
 * Parse the compact version output produced by yt-dlp or Node.
 */
function parseVersion(stdout: string, runtime: 'yt-dlp' | 'node'): string {
  const firstLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  if (!firstLine) {
    throw new Error(`${runtime} returned an empty version`)
  }
  if (runtime === 'node') {
    const match = /^v?(\d+\.\d+\.\d+\S*)/i.exec(firstLine)
    if (!match?.[1]) {
      throw new Error(`Unexpected Node version output: ${firstLine}`)
    }
    return match[1]
  }
  return firstLine
}

/**
 * Return whether a Unix file mode includes any execute bit.
 */
function isUnixExecutable(mode: number): boolean {
  return mode
    .toString(8)
    .slice(-3)
    .split('')
    .some((digit) => Number(digit) % 2 === 1)
}

/**
 * Build a persisted kernel component record from a verified file.
 */
function createKernelComponent(
  relativePath: string,
  sha256: string,
  version: string,
  size: number
): KernelPersistentState['active']['ytDlp'] {
  return { relativePath, sha256, size, version }
}

/**
 * Own the writable yt-dlp bundle used by Desktop. EJS uses bundled Node.
 */
export class YtDlpKernelService extends EventEmitter {
  private activePaths: KernelActivation | null = null
  private abortController: AbortController | null = null
  private checkTimer: ReturnType<typeof setTimeout> | null = null
  private readonly options: YtDlpKernelServiceOptions
  private persistentState: KernelPersistentState | null = null
  private preparePromise: Promise<boolean> | null = null
  private status = createInitialStatus()
  private stopped = false
  private updatePromise: Promise<void> | null = null

  /**
   * Create a kernel service with injected filesystem-adjacent dependencies.
   */
  constructor(options: YtDlpKernelServiceOptions) {
    super()
    this.options = { ...options, logger: options.logger ?? silentLogger }
  }

  /**
   * Return a defensive snapshot for IPC consumers.
   */
  getStatus(): YtDlpKernelStatus {
    return { ...this.status }
  }

  /**
   * Prepare the local bundle once and share concurrent callers.
   */
  prepare(): Promise<boolean> {
    if (!this.preparePromise) {
      this.preparePromise = this.prepareInternal().finally(() => {
        this.preparePromise = null
      })
    }
    return this.preparePromise
  }

  /**
   * Check official Stable releases while coalescing concurrent callers.
   */
  checkForUpdates(): Promise<void> {
    if (!this.updatePromise) {
      this.updatePromise = this.checkForUpdatesInternal().finally(() => {
        this.updatePromise = null
      })
    }
    return this.updatePromise
  }

  /**
   * Start the persisted background schedule after local preparation succeeds.
   */
  startBackgroundUpdates(): void {
    this.stopped = false
    if (!this.persistentState) {
      return
    }
    const nextCheckAt = this.persistentState.nextCheckAt ?? this.now()
    this.scheduleAt(nextCheckAt)
  }

  /**
   * Stop timers and child processes owned by the update service.
   */
  stop(): void {
    this.stopped = true
    if (this.checkTimer) {
      clearTimeout(this.checkTimer)
      this.checkTimer = null
    }
    this.abortController?.abort()
    this.abortController = null
    this.removeAllListeners()
  }

  /**
   * Update the current status and notify main-process subscribers.
   */
  private setStatus(status: YtDlpKernelStatus): void {
    this.status = status
    this.emit('status', this.getStatus())
  }

  /**
   * Prepare a managed copy, falling back to packaged binaries when needed.
   */
  private async prepareInternal(): Promise<boolean> {
    const wasReady = this.status.ready
    if (wasReady) {
      this.setStatus({ ...this.status, preparationStep: null, progress: null, state: 'checking' })
    }
    try {
      if (await this.activatePersistedBundle()) {
        return true
      }
      if (!wasReady) {
        this.setStatus(createInitialStatus())
      }
      return await this.prepareManagedBundle()
    } catch (error) {
      const managedError = formatKernelError(error)
      this.options.logger?.warn(`Managed kernel preparation failed: ${managedError}`)
      return this.activateBundledFallback(managedError)
    }
  }

  /**
   * Activate a still-current persisted bundle, or yield when the package is newer.
   */
  private async activatePersistedBundle(): Promise<boolean> {
    const state = await this.readState()
    if (!state) {
      return false
    }

    const active = await this.inspectPersistedBundle(state.active)
    if (active) {
      if (await this.shouldReplaceWithBundled(state.active.ytDlp.version)) {
        this.persistentState = state
        return false
      }
      const normalizedState: KernelPersistentState = state.previous
        ? { ...state, previous: null }
        : state
      if (normalizedState.previous !== state.previous) {
        try {
          await this.writeState(normalizedState)
        } catch (error) {
          this.options.logger?.warn(`Failed to drop superseded kernel pointer: ${String(error)}`)
        }
      }
      this.persistentState = normalizedState
      this.activateManagedPaths(active, normalizedState.active, await this.probeNodeVersion())
      await this.cleanupColdStartArtifacts()
      return true
    }

    if (!state.previous) {
      return false
    }
    const previous = await this.inspectPersistedBundle(state.previous)
    if (!previous) {
      return false
    }

    if (await this.shouldReplaceWithBundled(state.previous.ytDlp.version)) {
      this.persistentState = {
        ...state,
        active: state.previous,
        previous: null
      }
      return false
    }

    const recoveredState: KernelPersistentState = {
      ...state,
      active: state.previous,
      previous: null
    }
    try {
      await this.writeState(recoveredState)
    } catch (error) {
      this.options.logger?.warn(`Failed to persist previous kernel recovery: ${String(error)}`)
    }
    this.persistentState = recoveredState
    this.activateManagedPaths(previous, recoveredState.active, await this.probeNodeVersion())
    await this.cleanupColdStartArtifacts()
    return true
  }

  /**
   * Remove crash remnants and every managed bundle that is not the active kernel.
   */
  private async cleanupColdStartArtifacts(): Promise<void> {
    if (!this.persistentState) {
      return
    }
    const bundlesRoot = join(this.options.kernelRoot, 'bundles')
    const retainedBundleIds = new Set([this.persistentState.active.id])
    try {
      const [rootEntries, bundleEntries] = await Promise.all([
        readdir(this.options.kernelRoot, { withFileTypes: true }),
        readdir(bundlesRoot, { withFileTypes: true })
      ])
      const stalePaths = [
        ...rootEntries
          .filter(
            (entry) =>
              entry.name.startsWith('.staging-') ||
              (entry.name.startsWith('.state-') && entry.name.endsWith('.tmp'))
          )
          .map((entry) => join(this.options.kernelRoot, entry.name)),
        ...bundleEntries
          .filter((entry) => !retainedBundleIds.has(entry.name))
          .map((entry) => join(bundlesRoot, entry.name))
      ]
      await Promise.all(
        stalePaths.map((stalePath) => rm(stalePath, { force: true, recursive: true }))
      )
    } catch (error) {
      this.options.logger?.warn(`Failed to clean stale kernel artifacts: ${String(error)}`)
    }
  }

  /**
   * Read and schema-check the persistent kernel pointer.
   */
  private async readState(): Promise<KernelPersistentState | null> {
    try {
      const rawState = await readFile(join(this.options.kernelRoot, 'state.json'), 'utf8')
      return kernelPersistentStateSchema.parse(JSON.parse(rawState))
    } catch (error) {
      this.options.logger?.warn(`Kernel state is unavailable or invalid: ${String(error)}`)
      return null
    }
  }

  /**
   * Cheap-check a persisted bundle by path, type, execute bit, and recorded size.
   */
  private async inspectPersistedBundle(
    bundle: KernelPersistentState['active']
  ): Promise<KernelActivation | null> {
    try {
      const ytDlpPath = resolveKernelRelativePath(
        this.options.kernelRoot,
        bundle.ytDlp.relativePath
      )
      const ytDlpStat = await stat(ytDlpPath)
      this.assertExecutableStat(ytDlpPath, ytDlpStat)
      if (bundle.ytDlp.size != null && bundle.ytDlp.size !== ytDlpStat.size) {
        throw new Error('Kernel bundle size mismatch')
      }
      await this.assertExecutable(this.options.bundledNodePath)
      return { jsRuntimePath: this.options.bundledNodePath, ytDlpPath }
    } catch (error) {
      this.options.logger?.warn(`Kernel bundle ${bundle.id} failed validation: ${String(error)}`)
      return null
    }
  }

  /**
   * Return true when the packaged yt-dlp is newer than a still-valid managed copy.
   */
  private async shouldReplaceWithBundled(persistedVersion: string): Promise<boolean> {
    try {
      await this.assertExecutable(this.options.bundledYtDlpPath)
    } catch {
      return false
    }
    try {
      const bundledVersion = await this.probeVersion(this.options.bundledYtDlpPath, 'yt-dlp')
      if (compareYtDlpVersions(bundledVersion, persistedVersion) <= 0) {
        return false
      }
      this.options.logger?.info(
        `Packaged yt-dlp ${bundledVersion} is newer than managed ${persistedVersion}; copying the bundled kernel`
      )
      return true
    } catch (error) {
      this.options.logger?.warn(`Failed to probe bundled yt-dlp version: ${String(error)}`)
      return false
    }
  }

  /**
   * Activate verified managed paths and publish their stored versions.
   */
  private activateManagedPaths(
    paths: KernelActivation,
    bundle: KernelPersistentState['active'],
    nodeVersion: string
  ): void {
    this.options.activate(paths)
    this.activePaths = paths
    this.setStatus({
      error: null,
      nodeVersion,
      preparationStep: null,
      progress: null,
      ready: true,
      source: 'managed',
      state: 'up-to-date',
      ytDlpVersion: bundle.ytDlp.version
    })
  }

  /**
   * Return the injected or real wall-clock timestamp.
   */
  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  /**
   * Return the injected or real random fraction.
   */
  private random(): number {
    return this.options.random?.() ?? Math.random()
  }

  /**
   * Run one atomic candidate update and convert failures into retry state.
   */
  private async checkForUpdatesInternal(): Promise<void> {
    if (this.stopped) {
      return
    }
    if (!(this.persistentState && this.activePaths)) {
      const prepared = await this.prepare()
      if (!(prepared && this.persistentState && this.activePaths)) {
        this.scheduleAt(this.now() + getRetryDelayMs(1))
        return
      }
    }

    this.setStatus({
      ...this.status,
      preparationStep: null,
      progress: null,
      state: 'checking'
    })
    const abortController = new AbortController()
    const updateTimeout = setTimeout(() => {
      abortController.abort(new Error('Kernel update timed out'))
    }, UPDATE_TIMEOUT_MS)
    this.abortController = abortController
    let stagingPath: string | null = null
    try {
      stagingPath = await this.buildUpdatedCandidate(abortController.signal)
      if (!stagingPath) {
        await this.recordSuccessfulCheck()
        return
      }
      await this.commitUpdatedCandidate(stagingPath, abortController.signal)
      stagingPath = null
      await this.recordSuccessfulCheck()
    } catch (error) {
      if (this.stopped) {
        return
      }
      this.options.logger?.warn(`Kernel update failed; retry scheduled: ${String(error)}`)
      await this.recordFailedCheck()
    } finally {
      clearTimeout(updateTimeout)
      if (stagingPath) {
        await rm(stagingPath, { force: true, recursive: true })
      }
      if (this.abortController === abortController) {
        this.abortController = null
      }
    }
  }

  /**
   * Build and validate a complete candidate, returning null when nothing changed.
   */
  private async buildUpdatedCandidate(signal: AbortSignal): Promise<string | null> {
    const persistentState = this.persistentState
    const activePaths = this.activePaths
    if (!(persistentState && activePaths)) {
      throw new Error('Managed kernel is not ready')
    }

    const bundleId = randomUUID()
    const stagingPath = join(this.options.kernelRoot, `.staging-${bundleId}`)
    const ytDlpName = this.options.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
    const stagingYtDlpPath = join(stagingPath, ytDlpName)
    await mkdir(stagingPath, { recursive: false })
    try {
      await copyFile(activePaths.ytDlpPath, stagingYtDlpPath)
      await this.makeExecutable(stagingYtDlpPath)
      this.setStatus({ ...this.status, state: 'installing' })

      try {
        await this.options.runCommand(
          stagingYtDlpPath,
          ['--ignore-config', '--update-to', 'stable'],
          { signal, timeoutMs: UPDATE_TIMEOUT_MS }
        )
      } catch (error) {
        signal.throwIfAborted()
        this.options.logger?.warn(
          `yt-dlp --update-to failed, trying mirrored GitHub: ${String(error)}`
        )
        await this.downloadMirroredYtDlp(stagingYtDlpPath, signal)
      }
      signal.throwIfAborted()
      await Promise.all([
        rm(`${stagingYtDlpPath}.new`, { force: true }),
        rm(`${stagingYtDlpPath}.old`, { force: true })
      ])

      const ytDlpVersion = await this.probeVersion(stagingYtDlpPath, 'yt-dlp', signal)
      if (ytDlpVersion === persistentState.active.ytDlp.version) {
        await rm(stagingPath, { force: true, recursive: true })
        return null
      }

      return stagingPath
    } catch (error) {
      await rm(stagingPath, { force: true, recursive: true })
      throw error
    }
  }

  /**
   * Finalize a verified candidate and point state at the immutable bundle.
   */
  private async commitUpdatedCandidate(stagingPath: string, signal: AbortSignal): Promise<void> {
    const persistentState = this.persistentState
    if (!persistentState) {
      throw new Error('Persistent kernel state is unavailable')
    }
    const bundleId = basename(stagingPath).replace(/^\.staging-/, '')
    const finalBundlePath = join(this.options.kernelRoot, 'bundles', bundleId)
    const ytDlpName = this.options.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
    const stagingYtDlpPath = join(stagingPath, ytDlpName)
    const [ytDlpVersion, ytDlpSha256, ytDlpStat, nodeVersion] = await Promise.all([
      this.probeVersion(stagingYtDlpPath, 'yt-dlp', signal),
      hashFile(stagingYtDlpPath),
      stat(stagingYtDlpPath),
      this.probeNodeVersion(signal)
    ])
    signal.throwIfAborted()
    await rename(stagingPath, finalBundlePath)
    const finalYtDlpPath = join(finalBundlePath, ytDlpName)
    const updatedState: KernelPersistentState = {
      active: {
        id: bundleId,
        ytDlp: createKernelComponent(
          relative(this.options.kernelRoot, finalYtDlpPath),
          ytDlpSha256,
          ytDlpVersion,
          ytDlpStat.size
        )
      },
      failureCount: 0,
      nextCheckAt: 0,
      previous: null,
      schemaVersion: 2
    }
    signal.throwIfAborted()
    await this.writeState(updatedState)
    signal.throwIfAborted()
    this.persistentState = updatedState
    this.activateManagedPaths(
      { jsRuntimePath: this.options.bundledNodePath, ytDlpPath: finalYtDlpPath },
      updatedState.active,
      nodeVersion
    )
    await this.cleanupColdStartArtifacts()
  }

  /**
   * Persist the next successful check and schedule it with jitter.
   */
  private async recordSuccessfulCheck(): Promise<void> {
    if (!this.persistentState) {
      return
    }
    const nextCheckAt =
      this.now() + SUCCESS_INTERVAL_MS + Math.floor(this.random() * SUCCESS_JITTER_MS)
    const updatedState: KernelPersistentState = {
      ...this.persistentState,
      failureCount: 0,
      nextCheckAt
    }
    await this.writeState(updatedState)
    this.persistentState = updatedState
    this.setStatus({ ...this.status, state: 'up-to-date' })
    this.scheduleAt(nextCheckAt)
  }

  /**
   * Persist exponential backoff without changing the active bundle.
   */
  private async recordFailedCheck(): Promise<void> {
    if (!this.persistentState) {
      this.scheduleAt(this.now() + getRetryDelayMs(1))
      return
    }
    const failureCount = this.persistentState.failureCount + 1
    const nextCheckAt = this.now() + getRetryDelayMs(failureCount)
    const updatedState: KernelPersistentState = {
      ...this.persistentState,
      failureCount,
      nextCheckAt
    }
    try {
      await this.writeState(updatedState)
      this.persistentState = updatedState
    } catch (error) {
      this.options.logger?.warn(`Failed to persist kernel retry state: ${String(error)}`)
    }
    this.setStatus({ ...this.status, state: 'retry-scheduled' })
    this.scheduleAt(nextCheckAt)
  }

  /**
   * Schedule exactly one future background check.
   */
  private scheduleAt(timestamp: number): void {
    if (this.checkTimer) {
      clearTimeout(this.checkTimer)
      this.checkTimer = null
    }
    if (this.stopped) {
      return
    }
    const delay = Math.max(0, timestamp - this.now())
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null
      void this.checkForUpdates()
    }, delay)
  }

  /**
   * Copy, validate, persist, and activate the bundled pair in writable storage.
   */
  private async prepareManagedBundle(): Promise<boolean> {
    const bundlesRoot = join(this.options.kernelRoot, 'bundles')
    const bundleId = randomUUID()
    const stagingPath = join(this.options.kernelRoot, `.staging-${bundleId}`)
    const finalBundlePath = join(bundlesRoot, bundleId)
    const ytDlpName = this.options.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
    const stagingYtDlpPath = join(stagingPath, ytDlpName)

    await mkdir(bundlesRoot, { recursive: true })
    await mkdir(stagingPath, { recursive: false })
    try {
      const ytDlpStat = await stat(this.options.bundledYtDlpPath)
      const totalBytes = ytDlpStat.size
      let copiedBytes = 0
      const reportBytes = (bytes: number): void => {
        copiedBytes += bytes
        const progress = totalBytes === 0 ? 80 : Math.min(80, (copiedBytes / totalBytes) * 80)
        if (progress < 80 && Math.floor(progress) <= Math.floor(this.status.progress ?? -1)) {
          return
        }
        this.setStatus({
          ...this.status,
          preparationStep: 'copying',
          progress
        })
      }
      await copyFileWithProgress(this.options.bundledYtDlpPath, stagingYtDlpPath, reportBytes)
      await this.makeExecutable(stagingYtDlpPath)

      this.setStatus({ ...this.status, preparationStep: 'validating', progress: 80 })
      const ytDlpVersion = await this.probeVersion(stagingYtDlpPath, 'yt-dlp')
      this.setStatus({ ...this.status, progress: 88 })
      const nodeVersion = await this.probeNodeVersion()
      this.setStatus({ ...this.status, preparationStep: 'finalizing', progress: 95 })
      const ytDlpSha256 = await hashFile(stagingYtDlpPath)

      await rename(stagingPath, finalBundlePath)
      const finalYtDlpPath = join(finalBundlePath, ytDlpName)
      const persistentState: KernelPersistentState = {
        active: {
          id: bundleId,
          ytDlp: createKernelComponent(
            relative(this.options.kernelRoot, finalYtDlpPath),
            ytDlpSha256,
            ytDlpVersion,
            ytDlpStat.size
          )
        },
        failureCount: 0,
        nextCheckAt: 0,
        previous: null,
        schemaVersion: 2
      }
      await this.writeState(persistentState)
      this.setStatus({ ...this.status, preparationStep: 'finalizing', progress: 100 })
      this.persistentState = persistentState
      await this.cleanupColdStartArtifacts()
      this.activateManagedPaths(
        { jsRuntimePath: this.options.bundledNodePath, ytDlpPath: finalYtDlpPath },
        persistentState.active,
        nodeVersion
      )
      return true
    } catch (error) {
      await rm(stagingPath, { force: true, recursive: true })
      throw error
    }
  }

  /**
   * Validate and activate packaged resources without writable persistence.
   */
  private async activateBundledFallback(managedError: string | null = null): Promise<boolean> {
    try {
      await this.assertExecutable(this.options.bundledYtDlpPath)
      await this.assertExecutable(this.options.bundledNodePath)
      const [ytDlpVersion, nodeVersion] = await Promise.all([
        this.probeVersion(this.options.bundledYtDlpPath, 'yt-dlp'),
        this.probeNodeVersion()
      ])
      this.options.activate({
        jsRuntimePath: this.options.bundledNodePath,
        ytDlpPath: this.options.bundledYtDlpPath
      })
      this.activePaths = {
        jsRuntimePath: this.options.bundledNodePath,
        ytDlpPath: this.options.bundledYtDlpPath
      }
      this.setStatus({
        error: null,
        nodeVersion,
        preparationStep: null,
        progress: null,
        ready: true,
        source: 'bundled',
        state: 'bundled-fallback',
        ytDlpVersion
      })
      return true
    } catch (error) {
      const bundledError = formatKernelError(error)
      this.options.logger?.error(`Bundled kernel validation failed: ${bundledError}`)
      this.setStatus({
        error: buildUnavailableError(this.options, bundledError, managedError),
        nodeVersion: null,
        preparationStep: null,
        progress: null,
        ready: false,
        source: null,
        state: 'unavailable',
        ytDlpVersion: null
      })
      return false
    }
  }

  /**
   * Download the official yt-dlp binary when `--update-to` cannot reach GitHub.
   */
  private async downloadMirroredYtDlp(destPath: string, signal: AbortSignal): Promise<void> {
    const asset = getYtDlpReleaseAssetName(this.options.platform)
    const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`
    const response = await this.options.fetch(url, {
      headers: { 'User-Agent': 'VidBee-Desktop' },
      signal
    })
    if (!(response.ok && response.body)) {
      throw new Error(`yt-dlp mirror download failed with HTTP ${response.status}`)
    }
    const tmpPath = `${destPath}.part`
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(tmpPath), { signal })
    await rename(tmpPath, destPath)
    await this.makeExecutable(destPath)
  }

  /**
   * Ensure a copied binary is executable on Unix-like platforms.
   */
  private async makeExecutable(filePath: string): Promise<void> {
    if (this.options.platform !== 'win32') {
      await chmod(filePath, 0o755)
    }
  }

  /**
   * Require a regular executable file without mutating packaged resources.
   */
  private async assertExecutable(filePath: string): Promise<void> {
    this.assertExecutableStat(filePath, await stat(filePath))
  }

  /**
   * Require a regular executable file from an already-read stat result.
   */
  private assertExecutableStat(filePath: string, fileStat: Stats): void {
    if (!fileStat.isFile()) {
      throw new Error(`Kernel path is not a file: ${filePath}`)
    }
    if (this.options.platform !== 'win32' && !isUnixExecutable(fileStat.mode)) {
      throw new Error(`Kernel file is not executable: ${filePath}`)
    }
  }

  /**
   * Run and parse a bounded executable version probe.
   */
  private async probeVersion(
    filePath: string,
    runtime: 'yt-dlp' | 'node',
    signal?: AbortSignal
  ): Promise<string> {
    const result = await this.options.runCommand(filePath, ['--version'], {
      signal,
      timeoutMs: VERSION_PROBE_TIMEOUT_MS
    })
    return parseVersion(result.stdout, runtime)
  }

  /**
   * Probe the bundled Node used as yt-dlp's EJS runtime.
   */
  private probeNodeVersion(signal?: AbortSignal): Promise<string> {
    return this.probeVersion(this.options.bundledNodePath, 'node', signal)
  }

  /**
   * Persist state through a temporary file and atomic rename.
   */
  private async writeState(state: KernelPersistentState): Promise<void> {
    const validatedState = kernelPersistentStateSchema.parse(state)
    const temporaryPath = join(this.options.kernelRoot, `.state-${randomUUID()}.tmp`)
    await writeFile(temporaryPath, `${JSON.stringify(validatedState, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, join(this.options.kernelRoot, 'state.json'))
  }
}
