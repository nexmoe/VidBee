import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Task, TRANSCRIBABLE_TASK_KINDS } from '@vidbee/task-queue'
import {
  type AsrTierId,
  AutoTranscriptionCoordinator,
  buildTranscriptSources,
  captionLanguageKey,
  preferredCaptionLanguages as captionLanguagePreference,
  captionRecordNeedsSpeakers,
  collectGpuDevices,
  DEFAULT_ASR_TIER,
  DEFAULT_SPEAKER_COUNT,
  type ExtractedCaptionTrack,
  enqueueTranscription,
  extractEmbeddedCaptionTracks,
  findActiveTranscription,
  findSidecarCaptionTracks,
  type GpuKind,
  gpuKindFromHint,
  type InsertTranscriptSegmentInput,
  importCaptionsForDownload,
  importSidecarCaptionsIfPresent,
  isAsrTierId,
  listTranscriptionChildren,
  MINIMAL_MODEL_GROUPS,
  MINIMAL_MODEL_TIERS,
  ModelManager,
  type ModelPrepStatus,
  type ModelStatus,
  type PipelineSegment,
  parseAsrTier,
  parseSpeakerCount,
  readMachineProfile,
  readTranscriptionOptions,
  recommendAsrModels,
  recordForTranscriptSource,
  type SpeakerCount,
  startMinimalModelFill,
  switchToCaptionLanguage,
  type TranscriptionStage,
  type TranscriptRecord,
  type TranscriptSegmentPatch,
  type TranscriptSourceKind,
  type TranscriptSourceOption,
  type TranscriptStageTiming,
  TranscriptStore,
  toModelPrepStatus,
  transcriptionPartials
} from '@vidbee/transcription'
import { preferChinaMirrors } from '@vidbee/transcription/download-mirrors'
import { app, BrowserWindow } from 'electron'
import { settingsManager } from '../settings'
import { scopedLoggers } from '../utils/logger'
import { stopPromptRunsForDownload } from './ai-prompt-runner'
import { deletePersistedPromptRunsForDownload } from './ai-prompt-store'
import { getDatabaseConnection } from './database'
import { ffmpegManager } from './ffmpeg-manager'
import { type ImportLocalMediaResult, importLocalMediaFiles } from './import-local-media'
import { getDesktopTaskQueueRef } from './queue-ref'
import { resolveTaskSourceFile } from './source-file'
import { readElectronLocaleHints } from './system-locale'
import { resolveWorkerBundle } from './transcription-worker-path'

const logger = scopedLoggers.engine

export type TranscriptListState =
  | 'none'
  | 'queued'
  | 'running'
  | 'completed'
  | 'no-speech'
  | 'failed'
  | 'cancelled'
  | 'retry-scheduled'

export interface TranscriptSnapshot {
  downloadTaskId: string
  transcriptionTaskId: string | null
  transcriptId: string | null
  listState: TranscriptListState
  stage: TranscriptionStage | null
  stageHistory: TranscriptStageTiming[]
  error: string | null
  sourceFilePath: string | null
  title: string | null
  updatedAt: number
  record: TranscriptRecord | null
  asrTier: AsrTierId | null
  speakerCount: SpeakerCount
  sourceKind: TranscriptSourceKind | null
  sources: TranscriptSourceOption[]
  /** True while a speaker overlay task is queued or running. Recognition is not re-run. */
  rediarize: boolean
}

/**
 * Prefer the download title, then the local file name.
 *
 * @param download Parent download task, if present.
 * @param sourceFilePath Resolved media path.
 */
const titleFromDownload = (
  download: Task | undefined,
  sourceFilePath: string | null
): string | null => {
  const fromTask = download?.input.title?.trim()
  if (fromTask) {
    return fromTask
  }
  if (!sourceFilePath) {
    return null
  }
  const name = basename(sourceFilePath).trim()
  return name || null
}

export interface TranscriptPartialEvent {
  downloadTaskId: string
  taskId: string
  segments: PipelineSegment[]
}

let store: TranscriptStore | null = null
let models: ModelManager | null = null
let coordinator: AutoTranscriptionCoordinator | null = null
let modelFillStarted = false
let unsubscribeModelProgress: (() => void) | null = null
const viewingKeys = new Map<string, string>()

/**
 * Remember which captions-language or ASR source the user last opened.
 *
 * @param downloadTaskId Parent download id.
 * @param key `asr` or `captions:<language>`.
 */
const rememberTranscriptView = (downloadTaskId: string, key: string): void => {
  viewingKeys.set(downloadTaskId, key)
}

/**
 * True when this transcription child is relabeling speakers, not running ASR.
 *
 * @param task Active or latest transcription child.
 */
const isRediarizeTask = (task: Task | undefined): boolean =>
  Boolean(task && readTranscriptionOptions(task.input)?.rediarize)

/**
 * Keep the captions language selected while speakers are overlaid.
 *
 * @param record Current captions transcript.
 */
const rememberCaptionView = (record: TranscriptRecord | null): void => {
  if (record?.sourceKind !== 'captions') {
    return
  }
  rememberTranscriptView(record.downloadTaskId, `captions:${captionLanguageKey(record.language)}`)
}

/**
 * Queue speaker diarization on a captions transcript that has no speaker labels.
 *
 * @param downloadTaskId Parent download id.
 * @returns True when a rediarize task was created.
 */
export const overlayCaptionSpeakersIfNeeded = async (downloadTaskId: string): Promise<boolean> => {
  const queue = getDesktopTaskQueueRef()
  if (findActiveTranscription(queue, downloadTaskId)) {
    return false
  }
  const record = getTranscriptStore().getLatestForDownload(downloadTaskId)
  if (!captionRecordNeedsSpeakers(record)) {
    return false
  }
  const download = queue.get(downloadTaskId)
  const source = download ? resolveTaskSourceFile(download) : record?.sourceFilePath
  if (!source) {
    return false
  }
  rememberCaptionView(record)
  logger.info('transcription: caption speaker overlay queued', { downloadTaskId })
  await enqueueTranscription({
    queue,
    store: getTranscriptStore(),
    downloadTaskId,
    sourceFilePath: source,
    title: download?.input.title,
    trigger: 'force',
    rediarize: true,
    asrTier: readActiveAsrTierForDownload(downloadTaskId),
    language: readUiLanguage(),
    speakerCount: DEFAULT_SPEAKER_COUNT
  })
  return true
}

/**
 * Drop a live ASR view after cancel when no finished ASR row exists.
 *
 * @param downloadTaskId Parent download id.
 */
const clearLiveAsrView = (downloadTaskId: string): void => {
  if (viewingKeys.get(downloadTaskId) !== 'asr') {
    return
  }
  const hasAsr = getTranscriptStore()
    .listForDownload(downloadTaskId)
    .some((row) => row.sourceKind === 'asr' && row.resultKind === 'transcript')
  if (!hasAsr) {
    viewingKeys.delete(downloadTaskId)
  }
}

export const getTranscriptStore = (): TranscriptStore => {
  if (store) {
    return store
  }
  const { sqlite } = getDatabaseConnection()
  store = new TranscriptStore({ db: sqlite })
  return store
}

export const getModelManager = (): ModelManager => {
  if (models) {
    return models
  }
  models = new ModelManager({
    modelsDir:
      process.env.VIDBEE_TRANSCRIPTION_MODELS_DIR ??
      join(app.getPath('userData'), 'models', 'transcription'),
    preferChina: () =>
      preferChinaMirrors({
        ...readElectronLocaleHints(),
        mirror: settingsManager.get('downloadMirror')
      })
  })
  return models
}

/**
 * Path to the isolated AI worker bundle emitted next to the main process.
 */
export const resolveTranscriptionWorkerScript = (): string => {
  return resolveWorkerBundle(dirname(fileURLToPath(import.meta.url)))
}

export const resolveTranscriptionBackend = (): 'sherpa' | 'fake' =>
  process.env.VIDBEE_TRANSCRIPTION_BACKEND === 'fake' ? 'fake' : 'sherpa'

/**
 * Language tags used to pick a caption track, UI language first then English.
 */
export const preferredCaptionLanguages = (language = readUiLanguage()): string[] =>
  captionLanguagePreference(language)

/**
 * Extract text subtitle streams from a local file. Missing ffmpeg is a skip.
 *
 * @param sourceFilePath Resolved media path.
 * @returns Parsed caption tracks, or an empty list when extract is unavailable.
 */
const extractEmbeddedCaptions = async (
  sourceFilePath: string
): Promise<ExtractedCaptionTrack[]> => {
  try {
    const ffmpegPath = await ffmpegManager.ensureInitialized()
    return extractEmbeddedCaptionTracks({
      ffmpegPath,
      filePath: sourceFilePath,
      preferredLanguages: preferredCaptionLanguages()
    })
  } catch (error) {
    logger.warn('caption extract skipped', error)
    return []
  }
}

/**
 * Import sidecar or embedded captions for a finished download.
 *
 * @param downloadTaskId Parent download id.
 * @param sourceFilePath Resolved media path.
 */
export const importCaptionsForFinishedDownload = async (
  downloadTaskId: string,
  sourceFilePath: string
): Promise<boolean> => {
  const record = await importCaptionsForDownload({
    downloadTaskId,
    extractEmbedded: () => extractEmbeddedCaptions(sourceFilePath),
    preferredLanguages: preferredCaptionLanguages(),
    sourceFilePath,
    store: getTranscriptStore()
  })
  return record?.sourceKind === 'captions'
}

/**
 * Import sidecar caption files for already-downloaded media. Embedded extract
 * stays on the live download path so startup does not ffprobe the whole library.
 */
const scanCompletedDownloadsForCaptions = (): void => {
  const queue = getDesktopTaskQueueRef()
  let cursor: string | null = null
  do {
    const page = queue.list({ limit: 200, cursor })
    for (const task of page.tasks) {
      if (!TRANSCRIBABLE_TASK_KINDS.has(task.kind) || task.status !== 'completed') {
        continue
      }
      if (getTranscriptStore().getLatestForDownload(task.id)) {
        continue
      }
      const source = resolveTaskSourceFile(task)
      if (!source) {
        continue
      }
      const imported = importSidecarCaptionsIfPresent({
        downloadTaskId: task.id,
        preferredLanguages: preferredCaptionLanguages(),
        sourceFilePath: source,
        store: getTranscriptStore()
      })
      if (imported) {
        broadcastTranscript(getTranscriptSnapshot(task.id))
      }
    }
    cursor = page.nextCursor
  } while (cursor)
}

export const startAutoTranscription = (): void => {
  startHostGpuProbe()
  if (coordinator) {
    return
  }
  coordinator = new AutoTranscriptionCoordinator({
    queue: getDesktopTaskQueueRef(),
    store: getTranscriptStore(),
    isEnabled: () => settingsManager.get('autoTranscribeAfterDownload') === true,
    isModelsReady: () => readMinimalModelPrep().ready,
    resolveSourceFile: resolveTaskSourceFile,
    resolveAsrTier: () => readActiveAsrTier(),
    resolveLanguage: () => readUiLanguage(),
    tryImportCaptions: async ({ downloadTaskId, sourceFilePath }) => {
      const imported = await importCaptionsForFinishedDownload(downloadTaskId, sourceFilePath)
      if (imported) {
        if (settingsManager.get('autoTranscribeAfterDownload') === true) {
          await overlayCaptionSpeakersIfNeeded(downloadTaskId)
        }
        broadcastTranscript(getTranscriptSnapshot(downloadTaskId))
      }
      return imported
    },
    logger
  })
  coordinator.start()
  scanCompletedDownloadsForCaptions()
}

export const stopAutoTranscription = (): void => {
  coordinator?.stop()
  coordinator = null
}

/**
 * Keep an existing transcript visible when a speaker overlay ends without a new commit.
 *
 * @param task Latest transcription child.
 * @param record Current stored transcript, if any.
 */
const listStateFromFinishedRediarize = (
  task: Task,
  record: TranscriptRecord | null
): TranscriptListState | null => {
  if (!(isRediarizeTask(task) && record)) {
    return null
  }
  if (record.resultKind === 'no-speech') {
    return 'no-speech'
  }
  if (record.resultKind === 'transcript') {
    return 'completed'
  }
  return null
}

const listStateOf = (
  task: Task | undefined,
  record: TranscriptRecord | null
): TranscriptListState => {
  if (task) {
    if (task.status === 'queued') {
      return 'queued'
    }
    if (task.status === 'paused') {
      return task.statusReason === 'crash-recovery' ? 'running' : 'queued'
    }
    if (task.status === 'running' || task.status === 'processing') {
      return 'running'
    }
    if (task.status === 'retry-scheduled') {
      return 'retry-scheduled'
    }
    if (task.status === 'failed') {
      return listStateFromFinishedRediarize(task, record) ?? 'failed'
    }
    if (task.status === 'cancelled') {
      return listStateFromFinishedRediarize(task, record) ?? 'cancelled'
    }
    if (task.status === 'completed') {
      const kind = task.output?.transcript?.resultKind ?? record?.resultKind
      return kind === 'no-speech' ? 'no-speech' : 'completed'
    }
  }
  if (record?.resultKind === 'no-speech') {
    return 'no-speech'
  }
  if (record?.resultKind === 'transcript') {
    return 'completed'
  }
  return 'none'
}

const stageFromTask = (task: Task | undefined): TranscriptionStage | null => {
  if (!task || (task.status !== 'running' && task.status !== 'processing')) {
    return null
  }
  const reason = task.statusReason
  if (
    reason === 'preparing-models' ||
    reason === 'preparing-audio' ||
    reason === 'detecting-speech' ||
    reason === 'diarizing' ||
    reason === 'recognizing' ||
    reason === 'committing'
  ) {
    return reason
  }
  return task.status === 'processing' ? 'committing' : 'recognizing'
}

export const getTranscriptSnapshot = (downloadTaskId: string): TranscriptSnapshot => {
  const queue = getDesktopTaskQueueRef()
  const download = queue.get(downloadTaskId)
  const children = listTranscriptionChildren(queue, downloadTaskId)
  const active = findActiveTranscription(queue, downloadTaskId)
  const latest = children[0]
  let record =
    getTranscriptStore().getLatestForDownload(downloadTaskId) ??
    (latest ? getTranscriptStore().getByTranscriptionTaskId(latest.id) : null)
  const sourceFilePath = download
    ? resolveTaskSourceFile(download)
    : (record?.sourceFilePath ?? null)
  if (!record && sourceFilePath) {
    record = importSidecarCaptionsIfPresent({
      downloadTaskId,
      preferredLanguages: preferredCaptionLanguages(),
      sourceFilePath,
      store: getTranscriptStore()
    })
  }
  const task = active ?? latest
  const stored = getTranscriptStore().listForDownload(downloadTaskId)
  const sources = buildTranscriptSources({
    asrActive: Boolean(active && !isRediarizeTask(active)),
    current: record,
    preferredKey: viewingKeys.get(downloadTaskId),
    stored,
    tracks: sourceFilePath ? findSidecarCaptionTracks(sourceFilePath) : []
  })
  const selected = sources.find((item) => item.selected)
  const latestRecord = record
  record = recordForTranscriptSource(selected, stored, latestRecord)
  const listedRecord = record ?? latestRecord
  return {
    downloadTaskId,
    transcriptionTaskId: task?.id ?? listedRecord?.transcriptionTaskId ?? null,
    transcriptId: record?.id ?? null,
    listState: listStateOf(task, listedRecord),
    stage: transcriptionPartials.getByDownload(downloadTaskId)?.stage ?? stageFromTask(task),
    stageHistory: transcriptionPartials.getByDownload(downloadTaskId)?.stageHistory ?? [],
    error: task?.lastError?.rawMessage ?? null,
    sourceFilePath,
    title: titleFromDownload(download, sourceFilePath),
    updatedAt: Math.max(task?.updatedAt ?? 0, listedRecord?.updatedAt ?? 0),
    record,
    asrTier: isAsrTierId(record?.asrTier)
      ? record.asrTier
      : parseAsrTier(task?.input.options?.asrTier, DEFAULT_ASR_TIER),
    speakerCount: parseSpeakerCount(task?.input.options?.speakerCount, DEFAULT_SPEAKER_COUNT),
    sourceKind: selected?.kind ?? record?.sourceKind ?? (task ? 'asr' : null),
    sources,
    rediarize: isRediarizeTask(active)
  }
}

/**
 * Switch the visible transcript between caption languages and local ASR.
 * Switching to ASR does not start transcription; the user starts it from the empty pane.
 * Viewing captions does not cancel an in-flight ASR run.
 *
 * @param downloadTaskId Parent download id.
 * @param key `asr` or `captions:<language>`.
 */
export const selectTranscriptSource = async (
  downloadTaskId: string,
  key: string
): Promise<TranscriptSnapshot> => {
  const snapshot = getTranscriptSnapshot(downloadTaskId)
  const source = snapshot.sources.find((item) => item.key === key)
  if (!source) {
    return snapshot
  }
  rememberTranscriptView(downloadTaskId, key)
  if (source.kind === 'asr') {
    const stored = getTranscriptStore()
      .listForDownload(downloadTaskId)
      .find((row) => row.sourceKind === 'asr' && row.resultKind === 'transcript')
    if (stored) {
      getTranscriptStore().activate(downloadTaskId, stored.id)
    }
    const next = getTranscriptSnapshot(downloadTaskId)
    broadcastTranscript(next)
    return next
  }
  const sourceFilePath = snapshot.sourceFilePath
  if (sourceFilePath) {
    switchToCaptionLanguage({
      downloadTaskId,
      language: source.language ?? 'und',
      preferredLanguages: preferredCaptionLanguages(),
      sourceFilePath,
      store: getTranscriptStore()
    })
  }
  await overlayCaptionSpeakersIfNeeded(downloadTaskId)
  const next = getTranscriptSnapshot(downloadTaskId)
  broadcastTranscript(next)
  return next
}

export const getTranscriptStatusMap = (): Record<string, TranscriptSnapshot> => {
  const queue = getDesktopTaskQueueRef()
  const out: Record<string, TranscriptSnapshot> = {}
  let cursor: string | null = null
  do {
    const page = queue.list({ limit: 200, cursor })
    for (const task of page.tasks) {
      if (task.kind === 'transcription' && task.parentId && !out[task.parentId]) {
        out[task.parentId] = getTranscriptSnapshot(task.parentId)
      }
      if (TRANSCRIBABLE_TASK_KINDS.has(task.kind) && task.status === 'completed' && !out[task.id]) {
        const snapshot = getTranscriptSnapshot(task.id)
        if (snapshot.listState !== 'none') {
          out[task.id] = snapshot
        }
      }
    }
    cursor = page.nextCursor
  } while (cursor)
  for (const record of getTranscriptStore().listLatest()) {
    if (!out[record.downloadTaskId]) {
      out[record.downloadTaskId] = getTranscriptSnapshot(record.downloadTaskId)
    }
  }
  return out
}

/**
 * Import local audio/video files as completed downloads and start transcription.
 */
export const importLocalMediaForTranscription = async (
  paths: string[]
): Promise<ImportLocalMediaResult> => {
  const result = await importLocalMediaFiles({
    queue: getDesktopTaskQueueRef(),
    store: getTranscriptStore(),
    paths,
    language: readUiLanguage()
  })
  for (const item of result.imported) {
    broadcastTranscript(getTranscriptSnapshot(item.downloadId))
  }
  return result
}

/**
 * Enqueue a transcript for a finished download. `asrTier` pins the model on the task.
 * Caption import happens when the transcript page opens, not here.
 */
export const startTranscriptionForDownload = async (
  downloadTaskId: string,
  force = false,
  asrTier?: AsrTierId,
  speakerCount?: SpeakerCount
): Promise<TranscriptSnapshot> => {
  const queue = getDesktopTaskQueueRef()
  const download = queue.get(downloadTaskId)
  if (!download) {
    throw new Error(`download not found: ${downloadTaskId}`)
  }
  const source = resolveTaskSourceFile(download)
  if (!source) {
    throw new Error('source file missing')
  }
  if (!force) {
    const latestRecord = getTranscriptStore().getLatestForDownload(downloadTaskId)
    if (latestRecord?.sourceKind === 'captions' && latestRecord.resultKind === 'transcript') {
      const snapshot = getTranscriptSnapshot(downloadTaskId)
      broadcastTranscript(snapshot)
      return snapshot
    }
  }
  await enqueueTranscription({
    queue,
    store: getTranscriptStore(),
    downloadTaskId,
    sourceFilePath: source,
    title: download.input.title,
    trigger: force ? 'force' : 'manual',
    asrTier: asrTier ?? readActiveAsrTier(),
    language: readUiLanguage(),
    speakerCount: parseSpeakerCount(speakerCount, DEFAULT_SPEAKER_COUNT)
  })
  rememberTranscriptView(downloadTaskId, 'asr')
  const snapshot = getTranscriptSnapshot(downloadTaskId)
  broadcastTranscript(snapshot)
  return snapshot
}

export const retryTranscription = async (downloadTaskId: string): Promise<TranscriptSnapshot> => {
  const queue = getDesktopTaskQueueRef()
  const latest = listTranscriptionChildren(queue, downloadTaskId)[0]
  if (latest && (latest.status === 'failed' || latest.status === 'cancelled')) {
    await queue.retryManual(latest.id)
  } else {
    await startTranscriptionForDownload(downloadTaskId, false)
  }
  const snapshot = getTranscriptSnapshot(downloadTaskId)
  broadcastTranscript(snapshot)
  return snapshot
}

export const cancelTranscription = async (downloadTaskId: string): Promise<TranscriptSnapshot> => {
  const active = findActiveTranscription(getDesktopTaskQueueRef(), downloadTaskId)
  if (active) {
    await getDesktopTaskQueueRef().cancel(active.id, 'user')
  }
  clearLiveAsrView(downloadTaskId)
  const snapshot = getTranscriptSnapshot(downloadTaskId)
  broadcastTranscript(snapshot)
  return snapshot
}

/**
 * Build an empty snapshot so the renderer can drop a deleted transcript row.
 *
 * @param downloadTaskId Parent download id.
 */
export const emptyTranscriptSnapshot = (downloadTaskId: string): TranscriptSnapshot => ({
  downloadTaskId,
  transcriptionTaskId: null,
  transcriptId: null,
  listState: 'none',
  stage: null,
  stageHistory: [],
  error: null,
  sourceFilePath: null,
  title: null,
  updatedAt: Date.now(),
  record: null,
  asrTier: null,
  speakerCount: DEFAULT_SPEAKER_COUNT,
  sourceKind: null,
  sources: [],
  rediarize: false
})

/**
 * Drop stored transcripts, prompt runs, and live buffers for a download.
 * Queue child tasks are removed by `removeFromHistory`.
 *
 * @param downloadTaskId Parent download id.
 */
export const deleteTranscriptsForDownload = (downloadTaskId: string): void => {
  void import('./agent-chat-runner')
    .then(({ deleteAgentVideo }) => deleteAgentVideo(downloadTaskId))
    .catch((error) => logger.error('Failed to clean up video agent state', error))
  transcriptionPartials.clearByDownload(downloadTaskId)
  viewingKeys.delete(downloadTaskId)
  getTranscriptStore().deleteByDownload(downloadTaskId)
  stopPromptRunsForDownload(downloadTaskId)
  deletePersistedPromptRunsForDownload(downloadTaskId)
  broadcastTranscript(emptyTranscriptSnapshot(downloadTaskId))
}

interface HostGpuProbe {
  gpu: GpuKind
  gpuKinds: GpuKind[]
  gpuName: string | null
}

let gpuProbe: Promise<HostGpuProbe> | null = null

/**
 * Read Chromium GPU info once and cache the vendor used for recommendations.
 */
const probeHostGpu = async (): Promise<HostGpuProbe> => {
  if (!gpuProbe) {
    gpuProbe = (async () => {
      try {
        const info = await app.getGPUInfo('complete')
        const devices = collectGpuDevices(info)
        const machine = readMachineProfile({ devices })
        const gpuKinds = [
          ...new Set(devices.map(gpuKindFromHint).filter((kind) => kind !== 'unknown'))
        ]
        return { gpu: machine.gpu, gpuKinds, gpuName: machine.gpuName }
      } catch (error) {
        logger.warn('transcription: gpu probe failed', error)
        return { gpu: 'unknown', gpuKinds: [], gpuName: null }
      }
    })()
  }
  return gpuProbe
}

/**
 * Kick off GPU detection so the first settings open is not blocked.
 */
export const startHostGpuProbe = (): void => {
  void probeHostGpu()
}

/**
 * Return every detected GPU vendor so provider selection does not ignore inactive adapters.
 */
export const resolveTranscriptionGpuKinds = async (): Promise<readonly GpuKind[]> =>
  (await probeHostGpu()).gpuKinds

/**
 * Return on-disk model status plus a machine/language recommendation.
 */
export const getTranscriptionModelStatus = async (): Promise<ModelStatus> => {
  const status = getModelManager().status()
  const probed = await probeHostGpu()
  const machine = readMachineProfile(probed)
  const language = readUiLanguage()
  return {
    ...status,
    language,
    machine,
    recommended: recommendAsrModels({
      arch: machine.arch,
      cpuCount: machine.cpuCount,
      gpu: machine.gpu,
      language,
      os: machine.os,
      ramBytes: machine.ramBytes
    })
  }
}

export const redownloadTranscriptionModels = (): Promise<ModelStatus> =>
  getModelManager().redownload()

export const readActiveAsrTier = (): AsrTierId => {
  const stored = settingsManager.get('asrTier')
  return parseAsrTier(stored, DEFAULT_ASR_TIER)
}

/**
 * Return the Desktop UI language selected in settings.
 */
export const readUiLanguage = (): string => String(settingsManager.get('language') ?? 'en')

/**
 * Download one ASR package. A user cancel returns disk status instead of throwing.
 */
const downloadAsrTier = (tier: AsrTierId): Promise<ModelStatus> =>
  getModelManager().ensureReadyAllowCancel({ groups: MINIMAL_MODEL_GROUPS, tiers: [tier] })

export const setActiveAsrTier = async (tier: AsrTierId): Promise<ModelStatus> => {
  const status = await downloadAsrTier(tier)
  if (status.tiers.find((item) => item.id === tier)?.ready !== true) {
    return status
  }
  settingsManager.set('asrTier', tier)
  return getModelManager().status(undefined, [tier])
}

export const ensureAsrTier = (tier: AsrTierId): Promise<ModelStatus> => downloadAsrTier(tier)

/**
 * Stop an in-flight ASR model download and drop its partial files.
 */
export const cancelAsrTier = async (tier: AsrTierId): Promise<ModelStatus> => {
  getModelManager().cancelDownload(tier)
  return getTranscriptionModelStatus()
}

/**
 * Remove one downloaded ASR model. The model currently in use cannot be deleted.
 */
export const deleteAsrTier = async (tier: AsrTierId): Promise<ModelStatus> => {
  if (readActiveAsrTier() === tier) {
    throw new Error('cannot delete the active ASR model')
  }
  getModelManager().removeTier(tier)
  return getTranscriptionModelStatus()
}

export const getTranscriptPartials = (downloadTaskId: string): PipelineSegment[] => {
  const fromMemory = transcriptionPartials.getByDownload(downloadTaskId)
  if (fromMemory) {
    return fromMemory.segments
  }
  const active = findActiveTranscription(getDesktopTaskQueueRef(), downloadTaskId)
  if (!active) {
    return []
  }
  return transcriptionPartials.getByTask(active.id)?.segments ?? []
}

/**
 * Persist the new default model and enqueue a retranscribe immediately.
 * Model download happens inside the queued task, so leaving the page is safe.
 */
export const upgradeAndRetranscribe = async (
  downloadTaskId: string,
  tier: AsrTierId
): Promise<TranscriptSnapshot> => {
  settingsManager.set('asrTier', tier)
  logger.info('transcription: upgrade queued', { downloadTaskId, tier })
  return startTranscriptionForDownload(downloadTaskId, true, tier)
}

/**
 * Re-cluster speakers on the existing ASR words. Recognition is not run again.
 *
 * @param downloadTaskId Parent download id.
 * @param speakerCount Auto or an explicit speaker count from the detail page.
 */
export const rediarizeTranscription = async (
  downloadTaskId: string,
  speakerCount: SpeakerCount
): Promise<TranscriptSnapshot> => {
  const queue = getDesktopTaskQueueRef()
  const download = queue.get(downloadTaskId)
  if (!download) {
    throw new Error(`download not found: ${downloadTaskId}`)
  }
  const source = resolveTaskSourceFile(download)
  if (!source) {
    throw new Error('source file missing')
  }
  logger.info('transcription: rediarize queued', { downloadTaskId, speakerCount })
  const viewed = getTranscriptSnapshot(downloadTaskId).record
  if (viewed) {
    getTranscriptStore().activate(downloadTaskId, viewed.id)
  }
  const current = viewed ?? getTranscriptStore().getLatestForDownload(downloadTaskId)
  await enqueueTranscription({
    queue,
    store: getTranscriptStore(),
    downloadTaskId,
    sourceFilePath: source,
    title: download.input.title,
    trigger: 'force',
    rediarize: true,
    asrTier: readActiveAsrTierForDownload(downloadTaskId),
    language: readUiLanguage(),
    speakerCount: parseSpeakerCount(speakerCount, DEFAULT_SPEAKER_COUNT)
  })
  if (current?.sourceKind === 'captions') {
    rememberCaptionView(current)
  } else {
    rememberTranscriptView(downloadTaskId, 'asr')
  }
  const snapshot = getTranscriptSnapshot(downloadTaskId)
  broadcastTranscript(snapshot)
  return snapshot
}

/**
 * Prefer the ASR model already used on this download so a speaker re-run does not switch models.
 *
 * @param downloadTaskId Parent download id.
 */
const readActiveAsrTierForDownload = (downloadTaskId: string): AsrTierId => {
  const latest = getTranscriptStore()
    .listForDownload(downloadTaskId)
    .find((row) => row.sourceKind === 'asr' && isAsrTierId(row.asrTier))
  return latest?.asrTier && isAsrTierId(latest.asrTier) ? latest.asrTier : readActiveAsrTier()
}

/**
 * Current boot-set model readiness and download percent.
 */
export const readMinimalModelPrep = (): ModelPrepStatus =>
  toModelPrepStatus(getModelManager().status(MINIMAL_MODEL_GROUPS, MINIMAL_MODEL_TIERS))

/**
 * Push boot-set model prep progress to every renderer window.
 */
const broadcastModelPrep = (status = readMinimalModelPrep()): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('transcript:models', status)
    }
  }
}

/**
 * Start listening for model download progress and notify the UI.
 */
const subscribeModelProgressBroadcasts = (): void => {
  if (unsubscribeModelProgress) {
    return
  }
  unsubscribeModelProgress = getModelManager().subscribe(() => {
    broadcastModelPrep()
  })
  broadcastModelPrep()
}

/**
 * Enqueue downloads that finished while the boot models were still arriving.
 */
const flushDeferredAutoTranscriptions = (): void => {
  broadcastModelPrep()
  if (!coordinator) {
    return
  }
  void coordinator.flushPending()
}

export const startIdleMinimalModelFill = (): void => {
  subscribeModelProgressBroadcasts()
  if (modelFillStarted) {
    return
  }
  modelFillStarted = true
  startMinimalModelFill({
    models: getModelManager(),
    logger,
    onReady: flushDeferredAutoTranscriptions
  })
}

/**
 * Transcript id currently shown on the detail page.
 *
 * @param downloadTaskId Parent download id.
 */
const viewedTranscriptId = (downloadTaskId: string): string | null => {
  const snapshot = getTranscriptSnapshot(downloadTaskId)
  return snapshot.record?.id ?? snapshot.transcriptId
}

/**
 * Persist an edit on the transcript the user is viewing and broadcast it.
 *
 * @param downloadTaskId Parent download id.
 * @param segmentId Caption to change.
 * @param patch Text, speaker, or times.
 */
export const updateTranscriptSegment = (
  downloadTaskId: string,
  segmentId: string,
  patch: TranscriptSegmentPatch
): TranscriptSnapshot => {
  const transcriptId = viewedTranscriptId(downloadTaskId)
  if (!transcriptId) {
    throw new Error('Transcript is not ready to edit')
  }
  const record = getTranscriptStore().updateSegment(transcriptId, segmentId, patch)
  if (!record) {
    throw new Error('Caption could not be updated')
  }
  const next = getTranscriptSnapshot(downloadTaskId)
  broadcastTranscript(next)
  return next
}

/**
 * Delete captions on the transcript the user is viewing and broadcast it.
 *
 * @param downloadTaskId Parent download id.
 * @param segmentIds Caption ids to drop.
 */
export const deleteTranscriptSegments = (
  downloadTaskId: string,
  segmentIds: string[]
): TranscriptSnapshot => {
  const transcriptId = viewedTranscriptId(downloadTaskId)
  if (!transcriptId) {
    throw new Error('Transcript is not ready to edit')
  }
  const record = getTranscriptStore().deleteSegments(transcriptId, segmentIds)
  if (!record) {
    throw new Error('Captions could not be deleted')
  }
  const next = getTranscriptSnapshot(downloadTaskId)
  broadcastTranscript(next)
  return next
}

/**
 * Insert a caption on the transcript the user is viewing and broadcast it.
 *
 * @param downloadTaskId Parent download id.
 * @param input Neighbor, playhead, or explicit times.
 */
export const insertTranscriptSegment = (
  downloadTaskId: string,
  input: InsertTranscriptSegmentInput
): { segmentId: string; snapshot: TranscriptSnapshot } => {
  const transcriptId = viewedTranscriptId(downloadTaskId)
  if (!transcriptId) {
    throw new Error('Transcript is not ready to edit')
  }
  const inserted = getTranscriptStore().insertSegment(transcriptId, input)
  if (!inserted) {
    throw new Error('Caption could not be added')
  }
  const snapshot = getTranscriptSnapshot(downloadTaskId)
  broadcastTranscript(snapshot)
  return { segmentId: inserted.segmentId, snapshot }
}

export const broadcastTranscriptPartials = (
  downloadTaskId: string,
  segments: PipelineSegment[]
): void => {
  const payload: TranscriptPartialEvent = {
    downloadTaskId,
    taskId: transcriptionPartials.getByDownload(downloadTaskId)?.taskId ?? '',
    segments
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('transcript:partial', payload)
    }
  }
}

export const broadcastTranscript = (snapshot: TranscriptSnapshot): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('transcript:updated', snapshot)
    }
  }
}

export const subscribeTranscriptBroadcasts = (): void => {
  getDesktopTaskQueueRef().subscribe((event) => {
    if (event.type !== 'transition' && event.type !== 'snapshot-changed') {
      return
    }
    const taskId = event.type === 'transition' ? event.taskId : event.task.id
    const task = getDesktopTaskQueueRef().get(taskId)
    if (!task) {
      return
    }
    const downloadId = task.kind === 'transcription' ? task.parentId : task.id
    if (!downloadId) {
      return
    }
    if (task.kind !== 'transcription' && event.type === 'snapshot-changed') {
      return
    }
    broadcastTranscript(getTranscriptSnapshot(downloadId))
  })
}
