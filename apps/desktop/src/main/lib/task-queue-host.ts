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
import { TRANSCRIPT_DDL_V1 } from '@vidbee/db/transcripts'
import { YtDlpExecutor, type YtDlpTaskOptions } from '@vidbee/downloader-core'
import {
  ExecutorRouter,
  MemoryPersistAdapter,
  SqlitePersistAdapter,
  TaskQueueAPI
} from '@vidbee/task-queue'
import {
  applyTranscriptionConcurrency,
  mergeLegacyTaskQueueDb,
  nodeBinaryName,
  resolveBundledNodePath,
  TranscriptionExecutor
} from '@vidbee/transcription'
import { app, powerSaveBlocker } from 'electron'
import { settingsManager } from '../settings'
import { scopedLoggers } from '../utils/logger'
import { AsrModelExecutor } from './asr-model-executor'
import { resolveBundledResourcesPath } from './bundled-resources-path'
import { getDatabaseConnection } from './database'
import { startDownloadPowerSaveGuard } from './download-power-save'
import { applyExtensionCookieSettings } from './extension-cookies'
import { ffmpegManager } from './ffmpeg-manager'
import { MediaTransformExecutor } from './media-transform-executor'
import { setDesktopTaskQueueRef } from './queue-ref'
import {
  broadcastTranscript,
  broadcastTranscriptPartials,
  getModelManager,
  getTranscriptSnapshot,
  getTranscriptStore,
  resolveTranscriptionBackend,
  resolveTranscriptionGpuKinds,
  resolveTranscriptionWorkerScript,
  stopAutoTranscription
} from './transcript-host'
import { ytdlpManager } from './ytdlp-manager'

const LEGACY_TASK_QUEUE_DB_NAME = 'task-queue.db'

const resolveDownloadDir = (): string => {
  const fromSettings = settingsManager.get('downloadPath') as string | undefined
  if (fromSettings && typeof fromSettings === 'string' && fromSettings.trim().length > 0) {
    return fromSettings
  }
  return path.join(app.getPath('downloads'), 'VidBee')
}

const resolveLegacyTaskQueueDbPath = (): string => {
  const userData = app.getPath('userData')
  return path.join(userData, '.vidbee', LEGACY_TASK_QUEUE_DB_NAME)
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
    extraArgs: () => ytdlpManager.getJsRuntimeArgs?.() ?? [],
    prepareSettings: (input) =>
      applyExtensionCookieSettings(
        input.url,
        (input.options as YtDlpTaskOptions | undefined)?.settings
      )
  })

const buildPersistAdapter = (
  preferPersistent: boolean
): {
  adapter: MemoryPersistAdapter | SqlitePersistAdapter
  persistent: boolean
  dbPath: string | null
} => {
  if (!preferPersistent) {
    return { adapter: new MemoryPersistAdapter(), persistent: false, dbPath: null }
  }
  try {
    const { sqlite, path: unifiedPath } = getDatabaseConnection()
    sqlite.exec(TASK_QUEUE_DDL_V1)
    sqlite.exec(TRANSCRIPT_DDL_V1)
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const merged = mergeLegacyTaskQueueDb({
      target: sqlite,
      legacyPath: resolveLegacyTaskQueueDbPath(),
      openLegacy: (legacyPath) => new Database(legacyPath, { timeout: 5000, fileMustExist: true })
    })
    if (merged.merged) {
      scopedLoggers.engine.info(
        `task-queue-host: merged ${merged.tasksCopied} tasks from task-queue.db into vidbee.db`
      )
    }
    return {
      adapter: new SqlitePersistAdapter({
        db: sqlite as unknown as ConstructorParameters<typeof SqlitePersistAdapter>[0]['db'],
        ownsConnection: false
      }),
      persistent: true,
      dbPath: unifiedPath
    }
  } catch (err) {
    scopedLoggers.engine.warn(
      'task-queue-host: SQLite adapter unavailable, falling back to memory:',
      err
    )
    return { adapter: new MemoryPersistAdapter(), persistent: false, dbPath: null }
  }
}

const buildTranscriptionExecutor = (): TranscriptionExecutor => {
  const nodeName = nodeBinaryName()
  const resourcesDir = resolveBundledResourcesPath([`node/${nodeName}`])
  return new TranscriptionExecutor({
    store: getTranscriptStore(),
    workerScript: resolveTranscriptionWorkerScript(),
    modelsDir: getModelManager().modelsDir,
    resolveFfmpegPath: () => ffmpegManager.getPath(),
    backend: resolveTranscriptionBackend(),
    execPath: process.execPath,
    bundledNodePath: resolveBundledNodePath([resourcesDir]),
    workDir: path.join(app.getPath('userData'), 'transcript-work'),
    resolveGpuKinds: resolveTranscriptionGpuKinds,
    onPartial: ({ downloadTaskId, segments }) => {
      broadcastTranscriptPartials(downloadTaskId, segments)
    },
    onStage: ({ downloadTaskId }) => {
      broadcastTranscript(getTranscriptSnapshot(downloadTaskId))
    }
  })
}

export const getDesktopTaskQueue = (): TaskQueueAPI => {
  if (taskQueueInstance) {
    return taskQueueInstance
  }
  const { adapter, persistent: isPersistent, dbPath: unifiedPath } = buildPersistAdapter(true)
  dbPath = unifiedPath
  persistent = isPersistent
  const executor = new ExecutorRouter({
    defaultExecutor: buildExecutor(),
    byKind: {
      transcription: buildTranscriptionExecutor(),
      conversion: new MediaTransformExecutor(),
      'model-download': new AsrModelExecutor()
    }
  })
  const maxConcurrent = settingsManager.get('maxConcurrentDownloads')
  taskQueueInstance = new TaskQueueAPI({
    persist: adapter,
    executor,
    maxConcurrency: typeof maxConcurrent === 'number' && maxConcurrent > 0 ? maxConcurrent : 4
  })
  applyDesktopQueueConcurrency()
  setDesktopTaskQueueRef(taskQueueInstance)
  return taskQueueInstance
}

/**
 * Push the current download and transcription concurrency settings into the scheduler.
 */
export const applyDesktopQueueConcurrency = (): void => {
  void getDesktopTaskQueue().setMaxPerGroup('conversion', 1)
  void getDesktopTaskQueue().setMaxPerGroup('model-download', 1)
  applyTranscriptionConcurrency({
    queue: getDesktopTaskQueue(),
    maxConcurrentDownloads: settingsManager.get('maxConcurrentDownloads'),
    maxConcurrentTranscriptions: settingsManager.get('maxConcurrentTranscriptions')
  })
}

export const startDesktopTaskQueue = async (): Promise<void> => {
  if (started) {
    return
  }
  const queue = getDesktopTaskQueue()
  await queue.start()
  try {
    const { sqlite, path: persistPath } = getDatabaseConnection()
    const taskCount = Number(
      (
        sqlite.prepare('SELECT COUNT(*) AS n FROM tasks').get() as
          | { n: number | bigint }
          | undefined
      )?.n ?? 0
    )
    scopedLoggers.engine.info(
      `task-queue-host: started with ${taskCount} persisted tasks at ${persistPath}`
    )
  } catch {
    scopedLoggers.engine.info('task-queue-host: started and recovered in-flight tasks')
  }
  stopPowerSaveGuard = startDownloadPowerSaveGuard(queue, powerSaveBlocker)
  started = true
}

export const stopDesktopTaskQueue = async (): Promise<void> => {
  if (!started) {
    return
  }
  stopPowerSaveGuard?.()
  stopPowerSaveGuard = null
  stopAutoTranscription()
  await taskQueueInstance?.stop()
  started = false
}

export const isDesktopTaskQueuePersistent = (): boolean => persistent
export const getDesktopTaskQueueDbPath = (): string | null => dbPath
