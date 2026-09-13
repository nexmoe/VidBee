import type {
  TranscriptListState,
  TranscriptSegmentView,
  TranscriptSnapshotView
} from '../store/transcripts'

const ACTIVE_STATES = new Set<TranscriptListState>(['queued', 'retry-scheduled', 'running'])
const LISTED_STATES = new Set<TranscriptListState>([
  'cancelled',
  'completed',
  'failed',
  'no-speech',
  'queued',
  'retry-scheduled',
  'running'
])
const LIST_RANK: Record<string, number> = {
  running: 0,
  queued: 1,
  'retry-scheduled': 2,
  failed: 3
}

/**
 * Return whether a snapshot belongs on the transcript library list.
 *
 * @param listState Compact status from the transcript snapshot.
 */
export const isListedTranscript = (listState: TranscriptListState): boolean =>
  LISTED_STATES.has(listState)

/**
 * Return whether a snapshot is still queued or running.
 *
 * @param listState Compact status from the transcript snapshot.
 */
export const isInProgressTranscript = (listState: TranscriptListState): boolean =>
  ACTIVE_STATES.has(listState)

/**
 * Show the retry empty state when ASR failed, or when the user stopped a first
 * run before anything was committed. Cancelled-with-no-lines used to render a
 * blank captions pane.
 *
 * @param listState Compact status from the transcript snapshot.
 * @param hasRecord Whether a stored transcript still exists.
 * @param segmentCount Visible committed or partial lines.
 */
export const needsTranscriptRetry = (
  listState: TranscriptListState,
  hasRecord = false,
  segmentCount = 0
): boolean =>
  listState === 'failed' || (listState === 'cancelled' && !hasRecord && segmentCount === 0)

/** Inputs used to pick on-screen transcript rows during ASR or speaker overlay. */
export interface TranscriptWorkspaceViewInput {
  committed: TranscriptSegmentView[]
  hasRecord: boolean
  listState: TranscriptListState
  partials: TranscriptSegmentView[]
  rediarize?: boolean
  viewingCaptions: boolean
}

/** Visible transcript rows plus ready/live flags for the workspace. */
export interface TranscriptWorkspaceView {
  ready: boolean
  running: boolean
  segments: TranscriptSegmentView[]
  streamLive: boolean
}

/**
 * Pick the on-screen transcript while ASR, captions, or a speaker overlay is active.
 *
 * Speaker overlay reuses the stored text. It must not switch the AI transcript to an
 * empty live stream, or prompt results that depend on that text disappear with it.
 * A captions-only speaker overlay must not look like an ASR run on the AI tab.
 *
 * @param input Stored rows, live partials, and the current source/task.
 */
export const resolveTranscriptWorkspaceView = (
  input: TranscriptWorkspaceViewInput
): TranscriptWorkspaceView => {
  const pipelineRunning = isInProgressTranscript(input.listState)
  const captionOverlayOnAsr =
    pipelineRunning && input.rediarize === true && !input.viewingCaptions && !input.hasRecord
  const running = pipelineRunning && !captionOverlayOnAsr
  const relabelingSpeakers = running && input.rediarize === true
  const streamLive = running && !input.viewingCaptions && !relabelingSpeakers
  const segments = !streamLive && input.committed.length > 0 ? input.committed : input.partials
  const ready =
    (input.viewingCaptions && input.hasRecord) ||
    (relabelingSpeakers && input.hasRecord) ||
    (input.listState === 'completed' && (segments.length > 0 || input.hasRecord))
  return { ready, running, segments, streamLive }
}

/**
 * Start local ASR when the transcript page opens and no captions were imported.
 *
 * @param snapshot Compact status after `getForDownload` has tried caption import.
 */
export const shouldAutoStartAsr = (snapshot: {
  listState: TranscriptListState
  sourceFilePath?: string | null
}): boolean => snapshot.listState === 'none' && Boolean(snapshot.sourceFilePath)

/**
 * True when local ASR is already queued or running, not a captions speaker overlay.
 *
 * @param snapshot Compact transcript status for the open download.
 */
export const isAsrTaskInFlight = (snapshot: {
  listState?: TranscriptListState | null
  rediarize?: boolean
}): boolean => isInProgressTranscript(snapshot.listState ?? 'none') && snapshot.rediarize !== true

/**
 * Show the idle AI-transcript empty state until the user starts local ASR.
 *
 * @param input Visible source and workspace flags after switching to ASR.
 */
export const shouldOfferAsrStart = (input: {
  failed: boolean
  noSpeech: boolean
  ready: boolean
  running: boolean
  selectedSourceKind: 'asr' | 'captions' | null
}): boolean =>
  input.selectedSourceKind === 'asr' &&
  !input.failed &&
  !input.noSpeech &&
  !input.ready &&
  !input.running

/**
 * Build a one-line preview from transcript segments.
 *
 * @param segments Ordered transcript segments.
 * @param maxLength Maximum preview length, not including the ellipsis.
 * @returns Joined preview text, or an empty string when nothing is ready.
 */
export const previewTranscriptText = (
  segments: Pick<TranscriptSegmentView, 'text'>[],
  maxLength = 140
): string => {
  const joined = segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ')
  if (!joined) {
    return ''
  }
  if (joined.length <= maxLength) {
    return joined
  }
  return `${joined.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

/**
 * Pick the i18n key for in-page progress copy on the transcript workspace.
 *
 * @param listState Compact status from the transcript snapshot.
 * @param stage Live transcription stage, if the task is active.
 * @param hasTranscript Whether ASR text has already started streaming.
 * @returns A translation key under `transcript.*`.
 */
export const transcriptProgressLabelKey = (
  listState?: TranscriptListState | null,
  stage?: string | null,
  hasTranscript = false
): string => {
  if (listState === 'queued') {
    return 'transcript.library.queued'
  }
  if (listState === 'retry-scheduled') {
    return 'transcript.library.retrySoon'
  }
  if (stage === 'preparing-models' && hasTranscript) {
    return 'transcript.preparingSpeakerModels'
  }
  if (stage === 'preparing-models') {
    return 'transcript.modelsPreparing'
  }
  if (!stage || stage === 'preparing-audio') {
    return 'transcript.preparingAudio'
  }
  if (stage === 'detecting-speech') {
    return 'transcript.detectingSpeech'
  }
  if (stage === 'diarizing') {
    return 'transcript.identifyingSpeakers'
  }
  return 'transcript.transcribing'
}

export interface TranscriptThinkingStep {
  id: string
  labelKey: string
  status: 'active' | 'complete'
}

/**
 * Format a running duration for thinking-step labels.
 *
 * @param ms Elapsed milliseconds.
 */
export const formatElapsedClock = (ms: number): string => {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  if (minutes > 0) {
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }
  return `${seconds}s`
}

/**
 * Map a worker stage onto the user-facing thinking-step sequence.
 * Model downloads stay visible; after ASR they are labeled as speaker models.
 *
 * @param stage Raw worker stage.
 * @param previous User-facing stages already shown.
 */
export const toUserFacingTranscriptStage = (
  stage: string | null | undefined,
  previous: readonly string[] = []
): string => {
  const raw = stage?.trim() || 'preparing-audio'
  if (raw === 'queued' || raw === 'retry-scheduled') {
    return raw
  }
  const transcribed = previous.includes('recognizing')
  if (raw === 'preparing-models') {
    return transcribed ? 'preparing-speaker-models' : 'preparing-models'
  }
  if (raw === 'committing') {
    if (previous.includes('diarizing') || transcribed) {
      return 'diarizing'
    }
    return 'recognizing'
  }
  return raw
}

/**
 * i18n key for one user-facing thinking step.
 *
 * @param stage User-facing stage id.
 */
const thinkingStepLabelKey = (stage: string): string => {
  if (stage === 'queued') {
    return 'transcript.library.queued'
  }
  if (stage === 'retry-scheduled') {
    return 'transcript.library.retrySoon'
  }
  if (stage === 'preparing-speaker-models') {
    return 'transcript.preparingSpeakerModels'
  }
  return transcriptProgressLabelKey('running', stage)
}

export interface TimedThinkingStep extends TranscriptThinkingStep {
  endedAt: number
  startedAt: number
}

/**
 * Collapse persisted worker timings into user-facing thinking steps.
 *
 * @param history Raw stage timings from the host.
 * @param now Current wall clock for the active step.
 */
export const collapseTimedStages = (
  history: Array<{ stage: string; startedAt: number }>,
  now: number
): TimedThinkingStep[] => {
  const groups: Array<{ stage: string; startedAt: number }> = []
  for (const item of history.length > 0
    ? history
    : [{ stage: 'preparing-audio', startedAt: now }]) {
    const next = toUserFacingTranscriptStage(
      item.stage,
      groups.map((group) => group.stage)
    )
    if (groups.at(-1)?.stage === next) {
      continue
    }
    groups.push({ stage: next, startedAt: item.startedAt })
  }
  return groups.map((group, index) => ({
    endedAt: groups[index + 1]?.startedAt ?? now,
    id: `${group.stage}-${index}`,
    labelKey: thinkingStepLabelKey(group.stage),
    startedAt: group.startedAt,
    status: index === groups.length - 1 ? 'active' : 'complete'
  }))
}

/**
 * Turn the live ASR stage history into ThinkingSteps rows.
 *
 * @param stages Worker stages observed in order.
 */
export const transcriptThinkingSteps = (stages: string[]): TranscriptThinkingStep[] =>
  collapseTimedStages(
    stages.map((stage, index) => ({ stage, startedAt: index })),
    stages.length
  ).map(({ id, labelKey, status }) => ({ id, labelKey, status }))

/**
 * Pick the i18n key for a library row's status label.
 *
 * @param listState Compact status from the transcript snapshot.
 * @param sourceKind Caption vs ASR origin, when the row is complete.
 * @returns A translation key under `transcript.*`.
 */
export const transcriptLibraryStatusKey = (
  listState: TranscriptListState,
  sourceKind?: 'asr' | 'captions' | null
): string => {
  if (listState === 'running') {
    return 'transcript.library.processing'
  }
  if (listState === 'queued') {
    return 'transcript.library.queued'
  }
  if (listState === 'retry-scheduled') {
    return 'transcript.library.retrySoon'
  }
  if (listState === 'completed') {
    return sourceKind === 'captions' ? 'transcript.sourceCaptions' : 'transcript.ready'
  }
  if (listState === 'no-speech') {
    return 'transcript.noSpeech'
  }
  if (listState === 'failed') {
    return 'transcript.error'
  }
  if (listState === 'cancelled') {
    return 'transcript.library.cancelled'
  }
  return 'transcript.title'
}

export interface TranscriptLibrarySortItem {
  listState: TranscriptListState
  recency: number
}

/**
 * Sort library rows: active work first, then newest first.
 *
 * @param items Rows with a list state and recency timestamp.
 * @returns A new sorted array.
 */
export const sortTranscriptLibraryItems = <T extends TranscriptLibrarySortItem>(
  items: T[]
): T[] => {
  return [...items].sort((left, right) => {
    const rankDelta = (LIST_RANK[left.listState] ?? 8) - (LIST_RANK[right.listState] ?? 8)
    if (rankDelta !== 0) {
      return rankDelta
    }
    return right.recency - left.recency
  })
}

/**
 * Keep the newer snapshot when a full map reload races with live updates.
 *
 * @param previous Snapshot already on the renderer.
 * @param incoming Snapshot from IPC or a status-map reload.
 */
export const mergeTranscriptSnapshot = (
  previous: TranscriptSnapshotView | undefined,
  incoming: TranscriptSnapshotView
): TranscriptSnapshotView => {
  if (!previous) {
    return incoming
  }
  if ((incoming.updatedAt ?? 0) < (previous.updatedAt ?? 0)) {
    return previous
  }
  return incoming
}

/**
 * Apply a live snapshot: `none` drops the row, otherwise the newer snapshot wins.
 *
 * @param previous Current renderer map.
 * @param incoming Snapshot from IPC.
 */
export const applyTranscriptSnapshot = (
  previous: Record<string, TranscriptSnapshotView>,
  incoming: TranscriptSnapshotView
): Record<string, TranscriptSnapshotView> => {
  if (incoming.listState === 'none') {
    if (!(incoming.downloadTaskId in previous)) {
      return previous
    }
    const next = { ...previous }
    delete next[incoming.downloadTaskId]
    return next
  }
  return {
    ...previous,
    [incoming.downloadTaskId]: mergeTranscriptSnapshot(previous[incoming.downloadTaskId], incoming)
  }
}

/**
 * Overlay a freshly loaded status map without clobbering newer live rows.
 *
 * @param previous Current renderer map.
 * @param incoming Map from `getStatusMap`.
 */
export const mergeTranscriptMaps = (
  previous: Record<string, TranscriptSnapshotView>,
  incoming: Record<string, TranscriptSnapshotView>
): Record<string, TranscriptSnapshotView> => {
  const next = { ...previous }
  for (const [id, snapshot] of Object.entries(incoming)) {
    next[id] = mergeTranscriptSnapshot(previous[id], snapshot)
  }
  return next
}

/**
 * Display name from a local media path when the download title is missing.
 *
 * @param sourceFilePath Absolute path or null.
 */
export const titleFromSourcePath = (sourceFilePath: string | null | undefined): string => {
  if (!sourceFilePath) {
    return ''
  }
  const trimmed = sourceFilePath.replace(/[/\\]+$/, '')
  const parts = trimmed.split(/[/\\]/)
  return parts.at(-1) ?? ''
}
