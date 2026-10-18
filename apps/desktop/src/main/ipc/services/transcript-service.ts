import type {
  AsrTierId,
  ModelPrepStatus,
  ModelStatus,
  PipelineSegment,
  SpeakerCount
} from '@vidbee/transcription'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import {
  cancelVideoSubtitleExport,
  exportVideoWithSubtitles,
  type VideoSubtitleExportInput,
  type VideoSubtitleExportResult
} from '../../lib/export-video-subtitles'
import type { ImportLocalMediaResult } from '../../lib/import-local-media'
import { startDesktopTaskQueue } from '../../lib/task-queue-host'
import {
  broadcastTranscript,
  cancelAsrTier,
  cancelTranscription,
  deleteAsrTier,
  deleteTranscriptSegments,
  ensureAsrTier,
  getTranscriptionModelStatus,
  getTranscriptPartials,
  getTranscriptSnapshot,
  getTranscriptStatusMap,
  importCaptionsForFinishedDownload,
  importLocalMediaForTranscription,
  insertTranscriptSegment,
  overlayCaptionSpeakersIfNeeded,
  readMinimalModelPrep,
  readTranscriptDetail,
  readTranscriptPlaybackCues,
  rediarizeTranscription,
  redownloadTranscriptionModels,
  retryTranscription,
  selectTranscriptSource,
  setActiveAsrTier,
  startTranscriptionForDownload,
  type TranscriptListSnapshot,
  type TranscriptPlaybackCueSnapshot,
  type TranscriptSnapshot,
  updateTranscriptSegment,
  upgradeAndRetranscribe
} from '../../lib/transcript-host'

class TranscriptService extends IpcService {
  static readonly groupName = 'transcript'

  @IpcMethod()
  async getForDownload(_context: IpcContext, downloadId: string): Promise<TranscriptSnapshot> {
    await startDesktopTaskQueue()
    const snapshot = getTranscriptSnapshot(downloadId)
    if (snapshot.listState !== 'none' || !snapshot.sourceFilePath) {
      if (await overlayCaptionSpeakersIfNeeded(downloadId)) {
        const next = getTranscriptSnapshot(downloadId)
        broadcastTranscript(next)
        return next
      }
      return snapshot
    }
    const imported = await importCaptionsForFinishedDownload(downloadId, snapshot.sourceFilePath)
    const queued = await overlayCaptionSpeakersIfNeeded(downloadId)
    if (!(imported || queued)) {
      return snapshot
    }
    const next = getTranscriptSnapshot(downloadId)
    broadcastTranscript(next)
    return next
  }

  /**
   * Read the current detail without importing sidecars or starting a task.
   */
  @IpcMethod()
  getDetail(_context: IpcContext, downloadId: string): TranscriptSnapshot {
    return readTranscriptDetail(downloadId)
  }

  /**
   * Read cue text for the selected source. Word timestamps are not included.
   */
  @IpcMethod()
  getPlaybackCues(_context: IpcContext, downloadId: string): TranscriptPlaybackCueSnapshot | null {
    return readTranscriptPlaybackCues(downloadId)
  }

  @IpcMethod()
  async getStatusMap(_context: IpcContext): Promise<Record<string, TranscriptListSnapshot>> {
    await startDesktopTaskQueue()
    return getTranscriptStatusMap()
  }

  @IpcMethod()
  async importLocal(
    _context: IpcContext,
    input: { paths: string[] }
  ): Promise<ImportLocalMediaResult> {
    await startDesktopTaskQueue()
    return importLocalMediaForTranscription(input.paths)
  }

  @IpcMethod()
  async start(
    _context: IpcContext,
    input: { downloadId: string; force?: boolean; speakerCount?: SpeakerCount }
  ): Promise<TranscriptSnapshot> {
    await startDesktopTaskQueue()
    return startTranscriptionForDownload(
      input.downloadId,
      input.force === true,
      undefined,
      input.speakerCount
    )
  }

  /**
   * Re-label speakers on the current captions or ASR transcript with a pinned count.
   */
  @IpcMethod()
  async rediarize(
    _context: IpcContext,
    input: { downloadId: string; speakerCount: SpeakerCount }
  ): Promise<TranscriptSnapshot> {
    await startDesktopTaskQueue()
    return rediarizeTranscription(input.downloadId, input.speakerCount)
  }

  /**
   * Switch the visible transcript between caption languages and local ASR.
   */
  @IpcMethod()
  async selectSource(
    _context: IpcContext,
    input: { downloadId: string; key: string }
  ): Promise<TranscriptSnapshot> {
    await startDesktopTaskQueue()
    return selectTranscriptSource(input.downloadId, input.key)
  }

  @IpcMethod()
  async retry(_context: IpcContext, downloadId: string): Promise<TranscriptSnapshot> {
    await startDesktopTaskQueue()
    return retryTranscription(downloadId)
  }

  @IpcMethod()
  async cancel(_context: IpcContext, downloadId: string): Promise<TranscriptSnapshot> {
    await startDesktopTaskQueue()
    return cancelTranscription(downloadId)
  }

  @IpcMethod()
  async getModelStatus(_context: IpcContext): Promise<ModelStatus> {
    return getTranscriptionModelStatus()
  }

  /**
   * Boot-set model download progress for the in-app prep banner.
   */
  @IpcMethod()
  getModelPrepStatus(_context: IpcContext): ModelPrepStatus {
    return readMinimalModelPrep()
  }

  @IpcMethod()
  async redownloadModels(_context: IpcContext): Promise<ModelStatus> {
    return redownloadTranscriptionModels()
  }

  @IpcMethod()
  getPartials(_context: IpcContext, downloadId: string): PipelineSegment[] {
    return getTranscriptPartials(downloadId)
  }

  @IpcMethod()
  async ensureTier(_context: IpcContext, tier: AsrTierId): Promise<ModelStatus> {
    return ensureAsrTier(tier)
  }

  @IpcMethod()
  async setTier(_context: IpcContext, tier: AsrTierId): Promise<ModelStatus> {
    return setActiveAsrTier(tier)
  }

  @IpcMethod()
  async deleteTier(_context: IpcContext, tier: AsrTierId): Promise<ModelStatus> {
    return deleteAsrTier(tier)
  }

  @IpcMethod()
  async cancelTier(_context: IpcContext, tier: AsrTierId): Promise<ModelStatus> {
    return cancelAsrTier(tier)
  }

  @IpcMethod()
  async upgrade(
    _context: IpcContext,
    input: { downloadId: string; tier: AsrTierId }
  ): Promise<TranscriptSnapshot> {
    await startDesktopTaskQueue()
    return upgradeAndRetranscribe(input.downloadId, input.tier)
  }

  /**
   * Patch one caption on the transcript the user is viewing.
   */
  @IpcMethod()
  updateSegment(
    _context: IpcContext,
    input: {
      downloadId: string
      endMs?: number
      segmentId: string
      speakerId?: string | null
      startMs?: number
      text?: string
    }
  ): TranscriptSnapshot {
    return updateTranscriptSegment(input.downloadId, input.segmentId, {
      endMs: input.endMs,
      speakerId: input.speakerId,
      startMs: input.startMs,
      text: input.text
    })
  }

  /**
   * Delete one or more captions on the transcript the user is viewing.
   */
  @IpcMethod()
  deleteSegments(
    _context: IpcContext,
    input: { downloadId: string; segmentIds: string[] }
  ): TranscriptSnapshot {
    return deleteTranscriptSegments(input.downloadId, input.segmentIds)
  }

  /**
   * Insert a caption on the transcript the user is viewing.
   */
  @IpcMethod()
  insertSegment(
    _context: IpcContext,
    input: {
      afterId?: string | null
      atMs?: number
      beforeId?: string | null
      downloadId: string
      speakerId?: string | null
      text?: string
    }
  ): { segmentId: string; snapshot: TranscriptSnapshot } {
    return insertTranscriptSegment(input.downloadId, {
      afterId: input.afterId,
      atMs: input.atMs,
      beforeId: input.beforeId,
      speakerId: input.speakerId,
      text: input.text
    })
  }

  /**
   * Mux or burn the current transcript into a new video file.
   */
  @IpcMethod()
  exportVideo(
    _context: IpcContext,
    input: VideoSubtitleExportInput
  ): Promise<VideoSubtitleExportResult> {
    return exportVideoWithSubtitles(input)
  }

  /**
   * Stop an in-flight video-and-subtitle export.
   */
  @IpcMethod()
  cancelVideoExport(_context: IpcContext): void {
    cancelVideoSubtitleExport()
  }
}

export { TranscriptService }
