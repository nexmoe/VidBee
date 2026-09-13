import { sourceMediaKind } from '@shared/source-media-kind'
import type { DownloadRecord } from '../store/downloads'
import type { EnsurePlaybackSessionInput } from '../store/transcript-playback'
import type { TranscriptSnapshotView } from '../store/transcripts'

/**
 * Return the download record matching one playlist or library id.
 */
export const findDownloadRecord = (
  records: ReadonlyMap<string, DownloadRecord>,
  downloadId: string
): DownloadRecord | null => {
  for (const record of records.values()) {
    if (record.id === downloadId) {
      return record
    }
  }
  return null
}

/**
 * Build the shared player input used by transcript pages and playlist rows.
 */
export const buildTranscriptPlaybackInput = (input: {
  cachedThumbnail?: string | null
  download: DownloadRecord | null
  downloadId: string
  fallbackTitle: string
  snapshot: TranscriptSnapshotView | null
}): EnsurePlaybackSessionInput => {
  const { cachedThumbnail, download, downloadId, fallbackTitle, snapshot } = input
  const filePath = snapshot?.sourceFilePath
    ? snapshot.sourceFilePath
    : download?.savedFileName && download.downloadPath
      ? `${download.downloadPath}/${download.savedFileName}`
      : null
  const isAudio =
    sourceMediaKind({
      type: download?.type,
      filePath,
      savedFileName: download?.savedFileName
    }) === 'audio'
  return {
    downloadId,
    filePath,
    isAudio,
    subtitle: download?.channel ?? download?.uploader ?? null,
    thumbnail: cachedThumbnail ?? null,
    title: download?.title ?? snapshot?.title ?? fallbackTitle
  }
}

/**
 * Rebuild player input for the first persisted playlist item that still has media.
 */
export const resolveRestoredPlaybackInput = (input: {
  downloadIds: readonly string[]
  fallbackTitle: string
  records: ReadonlyMap<string, DownloadRecord>
  snapshots: Record<string, TranscriptSnapshotView | null | undefined>
}): EnsurePlaybackSessionInput | null => {
  for (const downloadId of input.downloadIds) {
    const playbackInput = buildTranscriptPlaybackInput({
      download: findDownloadRecord(input.records, downloadId),
      downloadId,
      fallbackTitle: input.fallbackTitle,
      snapshot: input.snapshots[downloadId] ?? null
    })
    if (playbackInput.filePath) {
      return playbackInput
    }
  }
  return null
}
