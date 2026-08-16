/**
 * Desktop host for @vidbee/task-queue (NEX-131, A1 artifact).
 *
 * Owns the single TaskQueueAPI instance the renderer (via the
 * `download-facade.ts` event emitter and IPC services) and the loopback
 * automation surface (`local-api.ts` /automation/v1/*) forward into.
 * SQLite-backed by default so crash recovery works per design §11.
 *
 * After the legacy stack removal (NEX-131 wrap-up), this is the only path
 * that owns yt-dlp execution / queue state / history persistence on the
 * desktop. The `historyManager` and `downloadEngine` exports are thin
 * facades over this API.
 */
import fs from 'node:fs'
import path from 'node:path'
import { TASK_QUEUE_DDL_V1 } from '@vidbee/db/task-queue'
import { YtDlpExecutor } from '@vidbee/downloader-core'
import { MemoryPersistAdapter, SqlitePersistAdapter, TaskQueueAPI } from '@vidbee/task-queue'
import { app, powerSaveBlocker } from 'electron'
import { settingsManager } from '../settings'
import { scopedLoggers } from '../utils/logger'
import { startDownloadPowerSaveGuard } from './download-power-save'
import { ffmpegManager } from './ffmpeg-manager'
import { ytdlpManager } from './ytdlp-manager'

const TASK_QUEUE_DB_NAME = 'task-queue.db'

const resolveDownloadDir = (): string => {
  const fromSettings = settingsManager.get('downloadPath') as string | undefined
  if (fromSettings && typeof fromSettings === 'string' && fromSettings.trim().length > 0) {
    return fromSettings
  }
  return path.join(app.getPath('downloads'), 'VidBee')
}

const resolveTaskQueueDbPath = (): string => {
  const userData = app.getPath('userData')
  return path.join(userData, '.vidbee', TASK_QUEUE_DB_NAME)
}

const resolveYtDlpPath = (): string => ytdlpManager.getPath()

const resolveFfmpegLocation = (): string | undefined => {
  try {
    const binaryPath = ffmpegManager.getPath()
    if (!binaryPath) {
      return undefined
    }
    return fs.statSync(binaryPath).isDirectory() ? binaryPath : path.dirname(binaryPath)
  } catch {
    return undefined
  }
}

let taskQueueInstance: TaskQueueAPI | null = null
let started = false
let dbPath: string | null = null
let persistent = false
let stopPowerSaveGuard: (() => void) | null = null

const buildExecutor = (): YtDlpExecutor =>
  new YtDlpExecutor({
    resolveYtDlpPath,
    resolveFfmpegLocation,
    defaultDownloadDir: resolveDownloadDir(),
    extraArgs: () => ytdlpManager.getJsRuntimeArgs?.() ?? []
  })

const buildPersistAdapter = (
  desiredDbPath: string,
  preferPersistent: boolean
): { adapter: MemoryPersistAdapter | SqlitePersistAdapter; persistent: boolean } => {
  if (!preferPersistent) {
    return { adapter: new MemoryPersistAdapter(), persistent: false }
  }
  try {
    fs.mkdirSync(path.dirname(desiredDbPath), { recursive: true })
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(desiredDbPath, { timeout: 5000 }) as unknown as {
      exec: (sql: string) => void
      prepare: (sql: string) => unknown
      pragma: (sql: string, opts?: { simple?: boolean }) => unknown
      transaction: (fn: (...args: unknown[]) => unknown) => unknown
      close: () => void
    }
    db.exec(TASK_QUEUE_DDL_V1)
    return {
      adapter: new SqlitePersistAdapter({
        db: db as unknown as ConstructorParameters<typeof SqlitePersistAdapter>[0]['db']
      }),
      persistent: true
    }
  } catch (err) {
    scopedLoggers.engine.warn(
      'task-queue-host: SQLite adapter unavailable, falling back to memory:',
      err
    )
    return { adapter: new MemoryPersistAdapter(), persistent: false }
  }
}

export const getDesktopTaskQueue = (): TaskQueueAPI => {
  if (taskQueueInstance) {
    return taskQueueInstance
  }
  const desiredDbPath = resolveTaskQueueDbPath()
  const { adapter, persistent: isPersistent } = buildPersistAdapter(desiredDbPath, true)
  dbPath = isPersistent ? desiredDbPath : null
  persistent = isPersistent
  const executor = buildExecutor()
  const maxConcurrent = settingsManager.get('maxConcurrentDownloads')
  taskQueueInstance = new TaskQueueAPI({
    persist: adapter,
    executor,
    maxConcurrency: typeof maxConcurrent === 'number' && maxConcurrent > 0 ? maxConcurrent : 4
  })
  return taskQueueInstance
}

export const startDesktopTaskQueue = async (): Promise<void> => {
  if (started) {
    return
  }
  const queue = getDesktopTaskQueue()
  await queue.start()
  stopPowerSaveGuard = startDownloadPowerSaveGuard(queue, powerSaveBlocker)
  started = true
}

export const stopDesktopTaskQueue = async (): Promise<void> => {
  if (!started) {
    return
  }
  stopPowerSaveGuard?.()
  stopPowerSaveGuard = null
  await taskQueueInstance?.stop()
  started = false
}

export const isDesktopTaskQueuePersistent = (): boolean => persistent
export const getDesktopTaskQueueDbPath = (): string | null => dbPath
