/**
 * apps/api host for @vidbee/task-queue.
 *
 * Constructs the single TaskQueueAPI used by /rpc/* and /events for the
 * Web/API surface, plus a thin yt-dlp metadata client used by `videoInfo`
 * and `playlist.info` (those calls are stateless and bypass the queue).
 *
 * Operational env vars (preserved from the pre-NEX-131 surface):
 *   VIDBEE_DOWNLOAD_DIR          – default download dir for new tasks
 *   VIDBEE_DATA_DIR              – settings/sqlite/models (default: $VIDBEE_DOWNLOAD_DIR/.vidbee)
 *   VIDBEE_MAX_CONCURRENT        – Scheduler.maxConcurrency
 *   VIDBEE_HISTORY_STORE_PATH    – legacy history sqlite path; only used by
 *                                  scripts/migrate-history.ts now
 *   VIDBEE_PERSIST_QUEUE=0       – keep the queue in memory (SQLite is the default)
 *   VIDBEE_DB                    – override the unified vidbee.db path
 *   YTDLP_PATH / FFMPEG_PATH     – binary overrides (unchanged)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { YtDlpExecutor } from '@vidbee/downloader-core'
import {
  ExecutorRouter,
  MemoryPersistAdapter,
  SqlitePersistAdapter,
  TaskQueueAPI,
  TRANSCRIPTION_GROUP_KEY
} from '@vidbee/task-queue'
import {
  AutoTranscriptionCoordinator,
  clampMaxConcurrentTranscriptions,
  extractEmbeddedCaptionTracks,
  importCaptionsForDownload,
  ModelManager,
  preferredCaptionLanguages,
  TranscriptionExecutor,
  TranscriptStore
} from '@vidbee/transcription'
import { apiDataDir, apiDefaultDownloadDir as resolvedDownloadDir, trimEnv } from './api-paths'
import { getDatabaseConnection } from './database'
import { resolveFfmpegLocation, resolveYtDlpPath } from './engines'

export const apiDefaultDownloadDir = resolvedDownloadDir

const parsedMaxConcurrent = Number(trimEnv('VIDBEE_MAX_CONCURRENT') ?? '')
export const apiMaxConcurrent =
  Number.isFinite(parsedMaxConcurrent) && parsedMaxConcurrent > 0 ? parsedMaxConcurrent : 4

const {
  persistent: persistEnabled,
  path: taskQueueDbPath,
  sqlite: sharedSqlite
} = getDatabaseConnection()

const unifiedDbDir = apiDataDir

const downloadExecutor = new YtDlpExecutor({
  resolveYtDlpPath,
  resolveFfmpegLocation,
  defaultDownloadDir: apiDefaultDownloadDir
})

const apiModelsDir = path.join(unifiedDbDir, 'models', 'transcription')
const apiHere = path.dirname(fileURLToPath(import.meta.url))
const apiWorkerCandidates = [
  path.join(apiHere, 'transcription-worker.js'),
  path.join(apiHere, '../../../../packages/transcription/src/worker/entry.ts')
]
const apiWorkerScript =
  apiWorkerCandidates.find((candidate) => fs.existsSync(candidate)) ?? apiWorkerCandidates[0]

const persist = persistEnabled
  ? new SqlitePersistAdapter({
      db: sharedSqlite as unknown as ConstructorParameters<typeof SqlitePersistAdapter>[0]['db'],
      ownsConnection: false
    })
  : new MemoryPersistAdapter()

export const transcriptStore = new TranscriptStore({ db: sharedSqlite })

export const modelManager = new ModelManager({ modelsDir: apiModelsDir })

const transcriptionExecutor = new TranscriptionExecutor({
  store: transcriptStore,
  workerScript: apiWorkerScript,
  modelsDir: apiModelsDir,
  execArgv: apiWorkerScript.endsWith('.ts') ? ['--import', 'tsx'] : undefined,
  resolveFfmpegPath: () => {
    const loc = resolveFfmpegLocation()
    if (!loc) {
      throw new Error('ffmpeg not found')
    }
    return fs.existsSync(path.join(loc, 'ffmpeg')) ? path.join(loc, 'ffmpeg') : loc
  },
  backend: process.env.VIDBEE_TRANSCRIPTION_BACKEND === 'fake' ? 'fake' : 'sherpa'
})

const executor = new ExecutorRouter({
  defaultExecutor: downloadExecutor,
  byKind: { transcription: transcriptionExecutor }
})

export const taskQueue = new TaskQueueAPI({
  persist,
  executor,
  maxConcurrency: apiMaxConcurrent
})

/**
 * Apply the transcription group cap without changing the env-based global slot budget.
 *
 * @param value Stored transcription concurrency setting.
 */
export const applyApiTranscriptionConcurrency = (value: unknown): void => {
  void taskQueue.setMaxPerGroup(TRANSCRIPTION_GROUP_KEY, clampMaxConcurrentTranscriptions(value))
}

void applyApiTranscriptionConcurrency(1)

export const taskQueueExecutor = downloadExecutor

let autoEnabled = false

const coordinator = new AutoTranscriptionCoordinator({
  queue: taskQueue,
  store: transcriptStore,
  isEnabled: () => autoEnabled,
  resolveSourceFile: (task) => task.output?.filePath ?? null,
  tryImportCaptions: async ({ downloadTaskId, sourceFilePath }) => {
    const loc = resolveFfmpegLocation()
    const binary = loc && fs.existsSync(path.join(loc, 'ffmpeg')) ? path.join(loc, 'ffmpeg') : loc
    const settings = await (await import('./web-settings-store')).webSettingsStore.get()
    const preferredLanguages = preferredCaptionLanguages(settings.language)
    const record = await importCaptionsForDownload({
      downloadTaskId,
      extractEmbedded: binary
        ? () =>
            extractEmbeddedCaptionTracks({
              ffmpegPath: binary,
              filePath: sourceFilePath,
              preferredLanguages
            })
        : undefined,
      preferredLanguages,
      sourceFilePath,
      store: transcriptStore
    })
    return record?.sourceKind === 'captions'
  }
})

let started = false
export const startTaskQueue = async (): Promise<void> => {
  if (started) {
    return
  }
  await taskQueue.start()
  try {
    const settings = await (await import('./web-settings-store')).webSettingsStore.get()
    autoEnabled = settings.autoTranscribeAfterDownload === true
    applyApiTranscriptionConcurrency(settings.maxConcurrentTranscriptions)
  } catch {
    autoEnabled = false
  }
  coordinator.start()
  started = true
}

export const setApiAutoTranscribe = (enabled: boolean): void => {
  autoEnabled = enabled
}

export const stopTaskQueue = async (): Promise<void> => {
  if (!started) {
    return
  }
  coordinator.stop()
  await taskQueue.stop()
  started = false
}

export const isTaskQueuePersistent = persistEnabled
export const taskQueueDbFile = taskQueueDbPath
