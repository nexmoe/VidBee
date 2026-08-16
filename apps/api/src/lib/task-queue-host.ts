/**
 * apps/api host for @vidbee/task-queue.
 *
 * Constructs the single TaskQueueAPI used by /rpc/* and /events for the
 * Web/API surface, plus a thin yt-dlp metadata client used by `videoInfo`
 * and `playlist.info` (those calls are stateless and bypass the queue).
 *
 * Operational env vars (preserved from the pre-NEX-131 surface):
 *   VIDBEE_DOWNLOAD_DIR          – default download dir for new tasks
 *   VIDBEE_MAX_CONCURRENT        – Scheduler.maxConcurrency
 *   VIDBEE_HISTORY_STORE_PATH    – legacy history sqlite path; only used by
 *                                  scripts/migrate-history.ts now
 *   VIDBEE_PERSIST_QUEUE=1       – switch from in-memory to SQLite-backed
 *                                  TaskQueue (matches Desktop crash recovery)
 *   VIDBEE_TASK_QUEUE_DB         – override task-queue sqlite path
 *   YTDLP_PATH / FFMPEG_PATH     – binary overrides (unchanged)
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { TASK_QUEUE_DDL_V1 } from '@vidbee/db/task-queue'
import { YtDlpExecutor } from '@vidbee/downloader-core'
import { MemoryPersistAdapter, SqlitePersistAdapter, TaskQueueAPI } from '@vidbee/task-queue'

const require = createRequire(import.meta.url)

const DEFAULT_DOWNLOAD_DIR_FALLBACK = path.join(os.homedir(), 'Downloads', 'VidBee')

const trimEnv = (name: string): string | undefined => {
  const v = process.env[name]?.trim()
  return v && v.length > 0 ? v : undefined
}

export const apiDefaultDownloadDir =
  trimEnv('VIDBEE_DOWNLOAD_DIR') ?? trimEnv('DOWNLOAD_DIR') ?? DEFAULT_DOWNLOAD_DIR_FALLBACK

const parsedMaxConcurrent = Number(trimEnv('VIDBEE_MAX_CONCURRENT') ?? '')
export const apiMaxConcurrent =
  Number.isFinite(parsedMaxConcurrent) && parsedMaxConcurrent > 0 ? parsedMaxConcurrent : 4

const persistEnabled = trimEnv('VIDBEE_PERSIST_QUEUE') === '1'

const taskQueueDbPath =
  trimEnv('VIDBEE_TASK_QUEUE_DB') ?? path.join(apiDefaultDownloadDir, '.vidbee', 'task-queue.db')

fs.mkdirSync(apiDefaultDownloadDir, { recursive: true })

let cachedYtDlpPath: string | null = null
const resolveYtDlpPath = (): string => {
  if (cachedYtDlpPath && fs.existsSync(cachedYtDlpPath)) {
    return cachedYtDlpPath
  }
  const envPath = trimEnv('YTDLP_PATH')
  if (envPath && fs.existsSync(envPath)) {
    cachedYtDlpPath = envPath
    return envPath
  }
  // Fall back to PATH lookup via execSync `which yt-dlp` / `where yt-dlp`.
  try {
    const out = require('node:child_process')
      .execSync(process.platform === 'win32' ? 'where yt-dlp' : 'which yt-dlp', {
        stdio: ['ignore', 'pipe', 'ignore']
      })
      .toString()
      .split(/\r?\n/)
      .map((s: string) => s.trim())
      .find((s: string) => s.length > 0)
    if (out && fs.existsSync(out)) {
      cachedYtDlpPath = out
      return out
    }
  } catch {
    /* noop */
  }
  throw new Error('yt-dlp binary not found. Set YTDLP_PATH or install yt-dlp in PATH.')
}

let cachedFfmpegLocation: string | null | undefined
const resolveFfmpegLocation = (): string | undefined => {
  if (cachedFfmpegLocation !== undefined) {
    return cachedFfmpegLocation ?? undefined
  }
  const envPath = trimEnv('FFMPEG_PATH')
  if (envPath) {
    try {
      const stats = fs.statSync(envPath)
      if (stats.isDirectory()) {
        cachedFfmpegLocation = envPath
        return envPath
      }
      const dir = path.dirname(envPath)
      cachedFfmpegLocation = dir
      return dir
    } catch {
      /* fall through */
    }
  }
  for (const candidate of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) {
    if (fs.existsSync(path.join(candidate, 'ffmpeg'))) {
      cachedFfmpegLocation = candidate
      return candidate
    }
  }
  cachedFfmpegLocation = null
  return undefined
}

const executor = new YtDlpExecutor({
  resolveYtDlpPath,
  resolveFfmpegLocation,
  defaultDownloadDir: apiDefaultDownloadDir
})

const buildPersistAdapter = () => {
  if (!persistEnabled) {
    return new MemoryPersistAdapter()
  }
  fs.mkdirSync(path.dirname(taskQueueDbPath), { recursive: true })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  const db = new Database(taskQueueDbPath, { timeout: 5000 }) as unknown as {
    exec: (sql: string) => void
    prepare: (sql: string) => unknown
    pragma: (sql: string, opts?: { simple?: boolean }) => unknown
    transaction: (fn: (...args: unknown[]) => unknown) => unknown
    close: () => void
  }
  db.exec(TASK_QUEUE_DDL_V1)
  return new SqlitePersistAdapter({
    // SqlitePersistAdapter accepts a structurally-typed db; better-sqlite3
    // matches the shape.
    db: db as unknown as ConstructorParameters<typeof SqlitePersistAdapter>[0]['db']
  })
}

export const taskQueue = new TaskQueueAPI({
  persist: buildPersistAdapter(),
  executor,
  maxConcurrency: apiMaxConcurrent
})

export const taskQueueExecutor = executor

let started = false
export const startTaskQueue = async (): Promise<void> => {
  if (started) {
    return
  }
  await taskQueue.start()
  started = true
}

export const stopTaskQueue = async (): Promise<void> => {
  if (!started) {
    return
  }
  await taskQueue.stop()
  started = false
}

export const isTaskQueuePersistent = persistEnabled
export const taskQueueDbFile = taskQueueDbPath
