/**
 * Probe and update download engines for the self-hosted API.
 *
 * yt-dlp is copied into VIDBEE_DATA_DIR/bin so Docker images can stay
 * read-only. FFmpeg stays on the system path. A daily check downloads a
 * newer official yt-dlp release when GitHub is reachable.
 */
import { execFile } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, rename } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { log } from '@vidbee/logger'
import { createGithubMirrorFetch, preferChinaMirrors } from '@vidbee/transcription/download-mirrors'
import { apiDataDir, trimEnv } from './api-paths'

const require = createRequire(import.meta.url)
const VERSION_TIMEOUT_MS = 15_000
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const GITHUB_YTDLP_LATEST = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
const GITHUB_YTDLP_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'

export type EngineState =
  | 'checking'
  | 'installing'
  | 'up-to-date'
  | 'unavailable'
  | 'update-available'

export interface EngineStatus {
  error: string | null
  ffmpegVersion: string | null
  latestYtDlpVersion: string | null
  nodeVersion: string
  state: EngineState
  ytDlpPath: string | null
  ytDlpVersion: string | null
}

let engineLanguage: string | undefined
let engineMirror: string | undefined
let cachedYtDlpPath: string | null = null
let cachedFfmpegLocation: string | null | undefined
let latestYtDlpVersion: string | null = null
let engineState: EngineState = 'checking'
let engineError: string | null = null
let autoTimer: ReturnType<typeof setInterval> | null = null
let updateInFlight: Promise<EngineStatus> | null = null

export const applyEngineDownloadSettings = (settings: {
  downloadMirror?: string
  language?: string
}): void => {
  engineMirror = settings.downloadMirror
  engineLanguage = settings.language
}

const githubFetch: typeof fetch = createGithubMirrorFetch(
  fetch,
  () => preferChinaMirrors({ language: engineLanguage, mirror: engineMirror }),
  UPDATE_TIMEOUT_MS
)

export const getYtDlpReleaseAssetName = (platform: string = process.platform): string => {
  if (platform === 'win32') {
    return 'yt-dlp.exe'
  }
  if (platform === 'darwin') {
    return 'yt-dlp_macos'
  }
  return 'yt-dlp_linux'
}

export const compareYtDlpVersions = (left: string, right: string): number => {
  const parseParts = (version: string): number[] =>
    version.split('.').map((part) => {
      const value = Number.parseInt(part, 10)
      return Number.isFinite(value) ? value : 0
    })
  const leftParts = parseParts(left)
  const rightParts = parseParts(right)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

const managedYtDlpPath = (): string =>
  path.join(apiDataDir, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')

const runCommand = (command: string, args: string[], timeoutMs: number): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.toString().trim() || error.message))
        return
      }
      resolve(`${stdout ?? ''}${stderr ?? ''}`)
    })
  })

const whichBinary = (name: string): string | null => {
  try {
    const out = require('node:child_process')
      .execSync(process.platform === 'win32' ? `where ${name}` : `which ${name}`, {
        stdio: ['ignore', 'pipe', 'ignore']
      })
      .toString()
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .find((line: string) => line.length > 0)
    return out && existsSync(out) ? out : null
  } catch {
    return null
  }
}

export const resolveYtDlpPath = (): string => {
  if (cachedYtDlpPath && existsSync(cachedYtDlpPath)) {
    return cachedYtDlpPath
  }
  const managed = managedYtDlpPath()
  if (existsSync(managed)) {
    cachedYtDlpPath = managed
    return managed
  }
  const envPath = trimEnv('YTDLP_PATH')
  if (envPath && existsSync(envPath)) {
    cachedYtDlpPath = envPath
    return envPath
  }
  const fromPath = whichBinary('yt-dlp')
  if (fromPath) {
    cachedYtDlpPath = fromPath
    return fromPath
  }
  throw new Error('yt-dlp binary not found. Set YTDLP_PATH or install yt-dlp in PATH.')
}

export const resolveFfmpegLocation = (): string | undefined => {
  if (cachedFfmpegLocation !== undefined) {
    return cachedFfmpegLocation ?? undefined
  }
  const envPath = trimEnv('FFMPEG_PATH')
  if (envPath) {
    try {
      if (existsSync(envPath)) {
        const { statSync } = require('node:fs') as typeof import('node:fs')
        const stats = statSync(envPath)
        cachedFfmpegLocation = stats.isDirectory() ? envPath : path.dirname(envPath)
        return cachedFfmpegLocation
      }
    } catch {
      /* fall through */
    }
  }
  for (const candidate of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) {
    if (existsSync(path.join(candidate, 'ffmpeg'))) {
      cachedFfmpegLocation = candidate
      return candidate
    }
  }
  const fromPath = whichBinary('ffmpeg')
  if (fromPath) {
    cachedFfmpegLocation = path.dirname(fromPath)
    return cachedFfmpegLocation
  }
  cachedFfmpegLocation = null
  return undefined
}

const resolveFfmpegBinary = (): string | null => {
  const location = resolveFfmpegLocation()
  if (!location) {
    return null
  }
  const binary = path.join(location, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  if (existsSync(binary)) {
    return binary
  }
  return existsSync(location) ? location : null
}

const parseYtDlpVersion = (output: string): string | null => {
  const match = output.match(/(\d{4}(?:\.\d+){2,})/)
  return match?.[1] ?? output.trim().split(/\s+/)[0] ?? null
}

const parseFfmpegVersion = (output: string): string | null => {
  const match = output.match(/ffmpeg version (\S+)/i)
  return match?.[1] ?? null
}

const probeYtDlpVersion = async (): Promise<{ path: string; version: string } | null> => {
  try {
    const binary = resolveYtDlpPath()
    const output = await runCommand(binary, ['--version'], VERSION_TIMEOUT_MS)
    const version = parseYtDlpVersion(output)
    if (!version) {
      return null
    }
    return { path: binary, version }
  } catch {
    cachedYtDlpPath = null
    return null
  }
}

const probeFfmpegVersion = async (): Promise<string | null> => {
  const binary = resolveFfmpegBinary()
  if (!binary) {
    return null
  }
  try {
    const output = await runCommand(binary, ['-version'], VERSION_TIMEOUT_MS)
    return parseFfmpegVersion(output)
  } catch {
    return null
  }
}

const fetchLatestYtDlpTag = async (): Promise<string | null> => {
  try {
    const response = await githubFetch(GITHUB_YTDLP_API, {
      headers: { 'User-Agent': 'VidBee-API', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(VERSION_TIMEOUT_MS)
    })
    if (!response.ok) {
      return null
    }
    const payload = (await response.json()) as { tag_name?: string }
    const tag = payload.tag_name?.replace(/^yt-dlp\s+/i, '').trim()
    return tag || null
  } catch {
    return null
  }
}

const snapshot = async (): Promise<EngineStatus> => {
  const ytDlp = await probeYtDlpVersion()
  const ffmpegVersion = await probeFfmpegVersion()
  return {
    error: engineError,
    ffmpegVersion,
    latestYtDlpVersion,
    nodeVersion: process.version.replace(/^v/, ''),
    state: engineState,
    ytDlpPath: ytDlp?.path ?? null,
    ytDlpVersion: ytDlp?.version ?? null
  }
}

export const getEngineStatus = async (): Promise<EngineStatus> => snapshot()

const downloadOfficialYtDlp = async (destPath: string): Promise<void> => {
  const asset = getYtDlpReleaseAssetName()
  const url = `${GITHUB_YTDLP_LATEST}/${asset}`
  const response = await githubFetch(url, {
    headers: { 'User-Agent': 'VidBee-API' },
    signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS)
  })
  if (!(response.ok && response.body)) {
    throw new Error(`yt-dlp download failed with HTTP ${response.status}`)
  }
  await mkdir(path.dirname(destPath), { recursive: true })
  const tmpPath = `${destPath}.part`
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(tmpPath))
  await rename(tmpPath, destPath)
  if (process.platform !== 'win32') {
    await chmod(destPath, 0o755)
  }
}

export const updateYtDlp = async (): Promise<EngineStatus> => {
  if (updateInFlight) {
    return updateInFlight
  }
  updateInFlight = (async () => {
    engineState = 'installing'
    engineError = null
    try {
      const destPath = managedYtDlpPath()
      await downloadOfficialYtDlp(destPath)
      cachedYtDlpPath = destPath
      const probed = await probeYtDlpVersion()
      if (!probed) {
        throw new Error('Updated yt-dlp did not report a version')
      }
      latestYtDlpVersion = probed.version
      engineState = 'up-to-date'
      log.info({
        event: 'engines',
        message: `yt-dlp updated to ${probed.version}`,
        meta: { path: destPath }
      })
      return snapshot()
    } catch (error) {
      engineError = error instanceof Error ? error.message : String(error)
      engineState = 'unavailable'
      log.warn({ event: 'engines', message: 'yt-dlp update failed', meta: { error: engineError } })
      const current = await snapshot()
      if (current.ytDlpVersion) {
        engineState = latestYtDlpVersion ? 'update-available' : 'up-to-date'
      }
      return snapshot()
    } finally {
      updateInFlight = null
    }
  })()
  return updateInFlight
}

export const checkEngineUpdates = async (): Promise<EngineStatus> => {
  engineState = 'checking'
  engineError = null
  const current = await probeYtDlpVersion()
  latestYtDlpVersion = await fetchLatestYtDlpTag()
  if (!current) {
    engineState = 'unavailable'
    engineError = 'yt-dlp binary not found'
    return snapshot()
  }
  if (latestYtDlpVersion && compareYtDlpVersions(current.version, latestYtDlpVersion) < 0) {
    engineState = 'update-available'
    return snapshot()
  }
  engineState = 'up-to-date'
  return snapshot()
}

const autoUpdateIfNeeded = async (): Promise<void> => {
  const status = await checkEngineUpdates()
  if (status.state === 'update-available' || status.state === 'unavailable') {
    await updateYtDlp()
  }
}

export const startEngines = async (): Promise<void> => {
  try {
    const { webSettingsStore } = await import('./web-settings-store')
    const settings = await webSettingsStore.get()
    applyEngineDownloadSettings({
      downloadMirror: settings.downloadMirror,
      language: settings.language
    })
  } catch {
    /* settings are optional during first boot */
  }
  try {
    await autoUpdateIfNeeded()
  } catch (error) {
    log.warn({
      event: 'engines',
      message: 'initial engine check failed',
      meta: { error: error instanceof Error ? error.message : String(error) }
    })
  }
  if (autoTimer) {
    return
  }
  autoTimer = setInterval(() => {
    void autoUpdateIfNeeded()
  }, AUTO_CHECK_INTERVAL_MS)
  autoTimer.unref?.()
}

export const stopEngines = (): void => {
  if (autoTimer) {
    clearInterval(autoTimer)
    autoTimer = null
  }
}
