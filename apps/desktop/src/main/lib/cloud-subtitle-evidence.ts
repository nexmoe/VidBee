import { getDesktopTaskQueueRef } from './queue-ref'
import { getTranscriptSnapshot } from './transcript-host'

/** Build provenance exclusively from the selected local record and downloader outcome. */
export const buildCloudSubtitleEvidence = (
  downloadId: string,
  text: string
): Record<string, unknown> | undefined => {
  const snapshot = getTranscriptSnapshot(downloadId)
  const record = snapshot.record
  if (!record) {
    return undefined
  }
  const task = getDesktopTaskQueueRef().get(downloadId)
  const acquisition = task?.output?.subtitleAcquisition
  const selected = snapshot.sources.find((source) => source.selected)
  const segments = record.segments.map((segment) => ({
    text: segment.text.trim(),
    start: segment.startMs / 1000,
    end: segment.endMs / 1000
  }))
  const actual = segments
    .map((segment) => segment.text)
    .join('\n')
    .trim()
  const unedited = record.updatedAt === record.createdAt && actual === text.trim()
  return {
    sourceId: task?.input.url,
    acquisition: task?.output?.subtitleStatus === 'downloaded' ? 'success' : undefined,
    acquisitionId: acquisition?.id,
    acquiredAt: acquisition?.acquiredAt,
    edited: !unedited,
    credentialsUsed: acquisition?.credentialsUsed,
    visibility: acquisition?.visibility,
    kind: record.sourceKind === 'asr' ? 'asr' : 'platform',
    track: selected ? (selected.auto ? 'automatic' : 'human') : 'unknown',
    language: record.language?.replace(/^ai[-_]/i, '') ?? undefined,
    duration: task?.output?.durationMs ? task.output.durationMs / 1000 : undefined,
    privateContext: false,
    externalDependencies: false,
    ...(actual === text.trim() ? { segments } : {})
  }
}
