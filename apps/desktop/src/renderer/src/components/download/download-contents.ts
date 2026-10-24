import { sourceMediaKind } from '@shared/source-media-kind'
import type {
  DownloadContentPart,
  DownloadContentState
} from '@vidbee/ui/components/ui/download-content-stack'
import { transcriptProgressLabelKey } from '../../lib/transcript-library'
import type { DownloadRecord } from '../../store/downloads'
import type { TranscriptSnapshotView } from '../../store/transcripts'
import { getFormatLabel, getQualityLabel } from './download-item-utils'

type TranslateFn = (key: string, options?: Record<string, unknown>) => string

type ContentTranscript = Pick<
  TranscriptSnapshotView,
  'error' | 'listState' | 'record' | 'sourceFilePath' | 'sourceKind' | 'stage'
>

export interface DownloadContents {
  /** Kind of the saved media file, or null when the row holds subtitles only. */
  media: 'audio' | 'video' | null
  notes: string[]
  parts: DownloadContentPart[]
}

/**
 * Join the present detail fragments with the row separator.
 */
const joinDetail = (...marks: Array<string | null | undefined>): string =>
  marks.filter(Boolean).join(' · ')

/**
 * Build the subtitles part from the transcript and the yt-dlp subtitle outcome.
 *
 * Transcription and a downloaded track are both subtitles, so one part covers both.
 */
const resolveSubtitlesPart = (
  download: DownloadRecord,
  transcript: ContentTranscript | null | undefined,
  medialess: boolean,
  t: TranslateFn
): DownloadContentPart | null => {
  const listState = transcript?.listState ?? 'none'
  const part = (state: DownloadContentState, detail: string): DownloadContentPart => ({
    detail,
    kind: 'subtitles',
    label: t('transcript.listLabel.subtitles'),
    state
  })
  if (listState === 'queued') {
    return part('busy', t('transcript.listHint.queued'))
  }
  if (listState === 'retry-scheduled') {
    return part('busy', t('transcript.listHint.retrySoon'))
  }
  if (listState === 'running') {
    return part('busy', t(transcriptProgressLabelKey('running', transcript?.stage)))
  }
  if (listState === 'completed' && transcript?.sourceKind !== 'captions') {
    return part(
      'ready',
      joinDetail(t('transcript.listLabel.transcribed'), transcript?.record?.language)
    )
  }
  if (download.subtitleStatus === 'downloaded' || listState === 'completed') {
    const languages = download.subtitleLanguages?.filter(Boolean).join(', ')
    const source =
      medialess && download.taskKind !== 'subtitles'
        ? t('transcript.listLabel.fromExtension')
        : t('transcript.listLabel.downloaded')
    return part('ready', joinDetail(source, languages || transcript?.record?.language))
  }
  if (listState === 'failed') {
    return part('danger', transcript?.error?.trim() || t('transcript.errorHint'))
  }
  if (download.subtitleStatus === 'failed') {
    return part('danger', t('transcript.listHint.subtitlesFailed'))
  }
  if (download.subtitleStatus === 'skipped-auth') {
    return part('warning', t('transcript.listHint.subtitlesAuth'))
  }
  return null
}

/**
 * Resolve what one download row holds: its media file, its subtitles, and notes
 * that explain subtitles which are absent.
 *
 * Subtitle tasks hold an export file rather than playable media. Browser-extension
 * captions have an empty output path and no media source either.
 * Legacy rows without a recorded file name leave `savedFileName` undefined.
 *
 * @param input Row record, its transcript list snapshot, and i18n translate.
 */
export const resolveDownloadContents = (input: {
  download: DownloadRecord
  t: TranslateFn
  transcript?: ContentTranscript | null
}): DownloadContents => {
  const { download, t, transcript } = input
  const listState = transcript?.listState ?? 'none'
  const medialess =
    download.taskKind === 'subtitles' ||
    (download.status === 'completed' &&
      download.savedFileName === '' &&
      !transcript?.sourceFilePath &&
      listState === 'completed')
  const parts: DownloadContentPart[] = []
  const media = medialess
    ? null
    : sourceMediaKind({
        type: download.type,
        filePath: transcript?.sourceFilePath,
        savedFileName: download.savedFileName
      })
  if (media) {
    parts.push({
      detail: joinDetail(getQualityLabel(download), getFormatLabel(download)),
      kind: media,
      label: t(media === 'audio' ? 'download.audio' : 'download.video'),
      state: 'ready'
    })
  }
  const subtitles = resolveSubtitlesPart(download, transcript, medialess, t)
  const notes: string[] = []
  if (subtitles) {
    parts.push(subtitles)
  } else {
    if (listState === 'no-speech') {
      notes.push(t('transcript.noSpeechDetail'))
    }
    if (listState === 'cancelled') {
      notes.push(t('transcript.listHint.cancelled'))
    }
    if (download.subtitleStatus === 'unavailable') {
      notes.push(t('transcript.listHint.subtitlesUnavailable'))
    }
  }
  return { media, notes, parts }
}
