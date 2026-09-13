export type { AsrLanguageStream, AsrModelPaths } from './asr-recognizer'
export {
  applyAsrStreamLanguage,
  asrLanguageForFamily,
  buildOfflineRecognizerConfig,
  familySupportsAsrLanguage,
  QWEN3_LANGUAGE_NAMES,
  resolveAsrModelPaths,
  SENSE_VOICE_LANGUAGE_CODES,
  tryRecognizerConfig,
  WHISPER_LANGUAGE_CODES
} from './asr-recognizer'
export type {
  GpuDeviceHint,
  GpuKind,
  MachineProfile,
  OsKind,
  RecommendAsrInput
} from './asr-recommend'
export {
  classifyGpuDevices,
  classifyMachine,
  collectGpuDevices,
  gpuKindFromHint,
  gpuNameFromDevices,
  isAppleSilicon,
  isWeakGpu,
  languageGroupFor,
  osKindFor,
  prettyGpuName,
  readMachineProfile,
  recommendAsrModels,
  resolveGpuProfile
} from './asr-recommend'
export type {
  AsrFamily,
  AsrLanguageGroup,
  AsrTierId,
  AsrTierInfo,
  MachineClass
} from './asr-tiers'
export {
  ASR_FAMILY_ORDER,
  ASR_TIER_IDS,
  ASR_TIERS,
  asrTierInfo,
  DEFAULT_ASR_TIER,
  higherAsrTiers,
  isAsrTierId,
  parseAsrTier,
  upgradeAsrTiers
} from './asr-tiers'
export type { AsrRecognizerResult, AsrWord } from './asr-words'
export { activeWordIndex, wordsFromAsrResult } from './asr-words'
export type { ExtractedAudio } from './audio'
export { extractMonoWav, isReusableExtractedWav, readPcmWav, TARGET_SAMPLE_RATE } from './audio'
export type {
  CaptionCue,
  CaptionTrack
} from './captions'
export {
  CAPTIONS_MODEL_VERSION,
  captionLanguageForMatch,
  captionLanguageKey,
  captionLanguageScore,
  captionsTaskId,
  cleanCaptionText,
  findSidecarCaptionTracks,
  isChatCaptionTag,
  isHumanCaptionTrack,
  isImportableCaptionTrack,
  isMachineCaptionPath,
  isMachineCaptionTag,
  isPlatformAiCaptionTag,
  isTextSubtitleCodec,
  languageFromSidecarName,
  parseAssCues,
  parseCaptionCues,
  parseCaptionTrack,
  pickCaptionTrack,
  pipelineResultFromCues,
  preferredCaptionLanguages,
  refineCaptionLanguage
} from './captions'
export type { ChineseScript } from './chinese-script'
export {
  applyChineseScript,
  applyChineseScriptToResult,
  applyChineseScriptToSegment,
  chineseScriptFromText,
  chineseScriptHint,
  chineseScriptOf,
  languageAfterChineseScript,
  looksLikeChinese
} from './chinese-script'
export type { ChunkManifest, ManifestChunk } from './chunk-manifest'
export {
  appendManifestChunk,
  ensureChunkManifest,
  loadChunkManifest,
  manifestWorkKey,
  sourceFingerprint
} from './chunk-manifest'
export type {
  SelectSherpaProviderInput,
  SherpaExecutionProvider,
  SherpaProviderProbeResult,
  SherpaProviderSelection
} from './compute-provider'
export {
  isSherpaProviderFallbackLog,
  SHERPA_EXECUTION_PROVIDERS,
  selectSherpaProvider,
  sherpaProviderCandidates
} from './compute-provider'
export type { TranscriptionConcurrencyQueue } from './concurrency'
export {
  applyTranscriptionConcurrency,
  CONCURRENT_TRANSCRIPTION_CHOICES,
  clampMaxConcurrentTranscriptions,
  DEFAULT_MAX_CONCURRENT_TRANSCRIPTIONS,
  MAX_CONCURRENT_TRANSCRIPTIONS
} from './concurrency'
export type { AutoTranscriptionCoordinatorOptions, ImportCaptionsRequest } from './coordinator'
export { AutoTranscriptionCoordinator } from './coordinator'
export type { EnqueueTranscriptionInput, EnqueueTranscriptionResult } from './enqueue'
export {
  enqueueTranscription,
  findActiveTranscription,
  listTranscriptionChildren
} from './enqueue'
export {
  classifyTranscriptionFailure,
  isNoAudioStreamError,
  NO_AUDIO_STREAM_ERROR,
  transcriptionError
} from './errors'
export type { TranscriptionBackend, TranscriptionExecutorOptions } from './executor'
export { TranscriptionExecutor } from './executor'
export type { ExtractedCaptionTrack } from './extract-captions'
export { extractEmbeddedCaptionTracks, ffprobePathFromFfmpeg } from './extract-captions'
export type { ImportCaptionsInput } from './import-captions'
export {
  commitCaptionTrack,
  importCaptionsForDownload,
  importSidecarCaptionsIfPresent,
  switchToCaptionLanguage
} from './import-captions'
export type { MinimalModelFillOptions } from './init-models'
export { startMinimalModelFill } from './init-models'
export { MemoryTranscriptStore } from './memory-store'
export type { MergeTaskQueueDbResult } from './migrate-task-queue-db'
export { mergeLegacyTaskQueueDb } from './migrate-task-queue-db'
export {
  catalogFor,
  MINIMAL_MODEL_GROUPS,
  MINIMAL_MODEL_TIERS,
  MODEL_CATALOG,
  modelVersion,
  QWEN3_ASR_MODEL_DIR
} from './model-catalog'
export type { EnsureReadyOptions, ModelManagerOptions } from './model-manager'
export {
  finalizeModelFile,
  isModelDownloadCancelled,
  MODEL_DOWNLOAD_CANCELLED,
  ModelManager,
  modelPartPath,
  removeModelPartFiles
} from './model-manager'
export type { ModelPrepStatus } from './model-progress'
export { modelFillPercent, toModelPrepStatus } from './model-progress'
export { resolveSherpaLibraryDir, resolveWorkerExecPath, sherpaWorkerEnv } from './native-env'
export { buildTranscriptionInput, readTranscriptionOptions } from './options'
export type { PartialTranscript } from './partial-buffer'
export { transcriptionPartials } from './partial-buffer'
export { FakeTranscriptionPipeline } from './pipeline-fake'
export {
  CLUSTERING_THRESHOLD,
  DIARIZE_NUM_THREADS,
  MAX_ASR_CHUNK_MS,
  MIN_DURATION_OFF_SEC,
  MIN_DURATION_ON_SEC,
  SherpaTranscriptionPipeline,
  splitTurnForAsr
} from './pipeline-sherpa'
export type { Punctuator } from './punctuate'
export {
  alignInsertions,
  needsPunctuation,
  PUNCT_SENTENCE_DENSITY_CHARS,
  PUNCT_WINDOW_CHARS,
  punctuateCues,
  punctuateText,
  punctuateWords
} from './punctuate'
export type {
  ProbeWorkerProviderInput,
  WorkerRuntime,
  WorkerRuntimeLayer
} from './runtime'
export {
  createFileProbeCache,
  DEFAULT_MAX_WORKER_RESTARTS,
  formatRuntimeLog,
  isElectronBinary,
  nodeBinaryName,
  probeCacheKey,
  probeWorkerProvider,
  resolveBundledNodePath,
  resolveWorkerRuntime
} from './runtime'
export type { PipelineSeed } from './speaker-assign'
export {
  assignSpeakersToSegments,
  captionRecordNeedsSpeakers,
  FALLBACK_TOKEN_CHARS,
  GIANT_TOKEN_CHARS,
  GIANT_TOKEN_MS,
  latestAsrSeed,
  latestTranscriptSeed,
  loadPipelineSeed,
  MAX_SEGMENT_CHARS,
  MAX_SEGMENT_MS,
  PARAGRAPH_GAP_MS,
  pipelineSeedFromRecord,
  SEED_TRANSCRIPT_FILE,
  seedDurationMs,
  singleSpeakerTurns,
  writePipelineSeed
} from './speaker-assign'
export type { DiarizeWindow, SpeakerEmbed } from './speaker-chunks'
export {
  capExcessClusters,
  DIARIZE_CHUNK_MS,
  DIARIZE_OVERLAP_MS,
  diarizeChunkWindows,
  foldShortClusters,
  MERGE_MIN_OVERLAP_MS,
  mergeChunkTurns,
  mergeChunkTurnsByEmbeddings,
  pickSpeakerEmbedTurns,
  SHORT_CLUSTER_FOLD_DISTANCE,
  SHORT_CLUSTER_MAX_MS,
  SHORT_CLUSTER_MS,
  SHORT_CLUSTER_SPEECH_FRACTION,
  SPEAKER_EMBED_MAX_MS,
  SPEAKER_EMBED_MIN_MS,
  shiftTurns,
  shortClusterFoldMs,
  stitchTurnsAtMidpoint
} from './speaker-chunks'
export type { SpeakerEmbedItem } from './speaker-cluster'
export {
  agglomerativeLabels,
  agglomerativeLabelsByThreshold,
  clusterSpeakerEmbeddings,
  cosineDistance,
  l2Normalize,
  MAX_BRIDGED_SPEAKERS
} from './speaker-cluster'
export type { SpeakerCount } from './speaker-count'
export {
  DEFAULT_SPEAKER_COUNT,
  isSpeakerCount,
  MAX_SPEAKER_COUNT,
  parseSpeakerCount,
  SPEAKER_COUNT_CHOICES,
  sherpaNumClusters
} from './speaker-count'
export {
  CAMPPLUS_FILE,
  CAMPPLUS_URL,
  ERES2NET_FILE,
  ERES2NET_URL,
  embeddingIdForLanguage,
  SPEAKER_EMBEDDING_CAMPPLUS_ID,
  SPEAKER_EMBEDDING_ERES2NET_ID,
  SPEAKER_EMBEDDING_TITANET_ID,
  TITANET_FILE,
  TITANET_URL
} from './speaker-embed'
export type { TimedTurn, TimeInterval } from './speaker-refine'
export {
  fillUncoveredTurns,
  intervalDurationMs,
  MAX_UNCOVERED_GAP_MS,
  MIN_CLUSTER_DURATION_MS,
  MIN_CLUSTER_TURN_MS,
  MIN_VAD_COVERAGE,
  mergeAdjacentTurns,
  refineSpeakerTurns,
  shouldTrustSpeechIntervals,
  turnsForAsr
} from './speaker-refine'
export type { InsertTranscriptSegmentInput, TranscriptSegmentPatch } from './transcript-edit'
export {
  applyTranscriptSegmentPatch,
  DEFAULT_CAPTION_DURATION_MS,
  deleteTranscriptSegmentsFromList,
  insertTranscriptSegmentInList,
  reindexTranscriptSegments,
  resolveInsertSegmentPlacement,
  updateTranscriptSegmentList
} from './transcript-edit'
export { buildTranscriptSources, recordForTranscriptSource } from './transcript-sources'
export type { TranscriptStoreOptions } from './transcript-store'
export { TranscriptStore } from './transcript-store'
export type {
  AsrTierStatus,
  MachineProfileStatus,
  ModelDownloadProgress,
  ModelStatus,
  PipelineResult,
  PipelineSegment,
  TranscriptionStage,
  TranscriptionTaskOptions,
  TranscriptionTrigger,
  TranscriptRecord,
  TranscriptSegment,
  TranscriptSourceKind,
  TranscriptSourceOption,
  TranscriptSpeaker,
  TranscriptStageTiming,
  TranscriptSummary,
  TranscriptWord
} from './types'
export { DEFAULT_MODEL_VERSION } from './types'
