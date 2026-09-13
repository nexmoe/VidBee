import { formatBytes } from '@renderer/components/settings/asr-model-shared'
import { formatClock } from '@renderer/lib/format-clock'
import { isAsrTierId } from '@vidbee/transcription/asr'
import { DownloadPlatformIcon } from '@vidbee/ui/components/ui/download-platform-icon'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export interface TranscriptInfoFields {
  asrTier?: string | null
  audioCodec?: string | null
  channel?: string | null
  codec?: string | null
  completedAt?: number | null
  createdAt?: number | null
  description?: string | null
  downloadPath?: string | null
  downloadedAt?: number | null
  durationMs?: number
  fileName?: string | null
  fileSize?: number | null
  format?: string | null
  formatNote?: string | null
  fps?: string | null
  language?: string | null
  platformDomain?: string | null
  platformLabel?: string | null
  playlist?: string | null
  protocol?: string | null
  quality?: string | null
  segmentCount: number
  sourceKind?: 'asr' | 'captions' | null
  speakerCount: number
  startedAt?: number | null
  subscription?: string | null
  tags?: string | null
  url?: string | null
  videoCodec?: string | null
  views?: string | null
  width?: string | null
}

type InfoGroupKey = 'file' | 'media' | 'transcript'

interface InfoRow {
  href?: string
  key: string
  label: string
  platformDomain?: string | null
  showPlatformIcon?: boolean
  value: string
}

interface InfoGroup {
  key: InfoGroupKey
  label: string
  rows: InfoRow[]
}

const GROUP_ORDER: InfoGroupKey[] = ['media', 'file', 'transcript']

/**
 * Take the last path segment from a local file path.
 */
export const fileNameFromPath = (path: string | null | undefined): string | null => {
  if (!path) {
    return null
  }
  const name = path.split(/[/\\]/).pop()?.trim()
  return name || null
}

/**
 * True when the string is an http(s) URL that can be opened in a browser.
 */
export const isRemoteHttpUrl = (url: string | null | undefined): url is string =>
  Boolean(url && /^https?:\/\//i.test(url))

/**
 * Resolve a BCP-47 tag to a locale-aware language name.
 */
export const languageDisplayName = (code: string, locale: string): string => {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

/**
 * True when at least one info field can be shown.
 */
export const hasTranscriptInfo = (info: TranscriptInfoFields): boolean =>
  Boolean(
    info.channel ||
      info.platformLabel ||
      info.playlist ||
      info.quality ||
      info.format ||
      info.codec ||
      info.description ||
      info.views ||
      info.tags ||
      info.downloadPath ||
      info.subscription ||
      (info.durationMs && info.durationMs > 0) ||
      info.fileName ||
      (info.fileSize && info.fileSize > 0) ||
      isRemoteHttpUrl(info.url) ||
      info.sourceKind ||
      info.asrTier ||
      info.language ||
      info.createdAt ||
      info.downloadedAt ||
      info.startedAt ||
      info.completedAt ||
      info.segmentCount > 0 ||
      info.speakerCount > 0
  )

/**
 * Media and transcript metadata for the workspace Info tab, grouped by topic.
 */
export function TranscriptInfoPane(info: TranscriptInfoFields) {
  const { t, i18n } = useTranslation()
  const groups = useMemo(() => buildInfoGroups(info, t, i18n.language), [i18n.language, info, t])
  if (groups.length === 0) {
    return <p className="px-4 py-6 text-muted-foreground text-sm">{t('transcript.info.empty')}</p>
  }

  return (
    <div className="pb-3" data-testid="transcript-info">
      {groups.map((group) => (
        <section data-testid={`transcript-info-group-${group.key}`} key={group.key}>
          <h3 className="bg-muted/50 px-4 py-1.5 font-medium text-muted-foreground text-xs">
            {group.label}
          </h3>
          <dl className="divide-y divide-border/50">
            {group.rows.map((row) => (
              <InfoRowView key={row.key} openUrlLabel={t('transcript.info.openUrl')} row={row} />
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

interface InfoRowViewProps {
  openUrlLabel: string
  row: InfoRow
}

/**
 * One label/value row. Matches the original Info tab row layout.
 */
function InfoRowView({ openUrlLabel, row }: InfoRowViewProps) {
  return (
    <div className="flex gap-3 px-4 py-2.5">
      <dt className="w-28 shrink-0 pt-0.5 text-muted-foreground text-xs">{row.label}</dt>
      <dd className="min-w-0 flex-1 text-sm">
        {row.href ? (
          <a
            aria-label={openUrlLabel}
            className="wrap-break-word text-primary hover:underline"
            href={row.href}
            rel="noopener noreferrer"
            target="_blank"
          >
            {row.value}
          </a>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {row.showPlatformIcon ? (
              <DownloadPlatformIcon className="block size-3.5" domain={row.platformDomain} />
            ) : null}
            <span className="wrap-break-word">{row.value}</span>
          </span>
        )}
      </dd>
    </div>
  )
}

/**
 * Build topic groups of visible Info tab rows from media and transcript fields.
 */
const buildInfoGroups = (
  info: TranscriptInfoFields,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string
): InfoGroup[] => {
  const buckets: Record<InfoGroupKey, InfoRow[]> = {
    file: [],
    media: [],
    transcript: []
  }
  if (info.platformLabel) {
    buckets.media.push({
      key: 'platform',
      label: t('download.metadata.platform'),
      platformDomain: info.platformDomain,
      showPlatformIcon: true,
      value: info.platformLabel
    })
  }
  if (info.channel) {
    buckets.media.push({ key: 'channel', label: t('transcript.info.channel'), value: info.channel })
  }
  if (info.playlist) {
    buckets.media.push({
      key: 'playlist',
      label: t('download.metadata.playlist'),
      value: info.playlist
    })
  }
  if (info.durationMs && info.durationMs > 0) {
    buckets.media.push({
      key: 'duration',
      label: t('transcript.info.duration'),
      value: formatClock(info.durationMs / 1000)
    })
  }
  if (info.views) {
    buckets.media.push({ key: 'views', label: t('download.metadata.views'), value: info.views })
  }
  if (info.tags) {
    buckets.media.push({ key: 'tags', label: t('download.metadata.tags'), value: info.tags })
  }
  if (isRemoteHttpUrl(info.url)) {
    buckets.media.push({
      href: info.url,
      key: 'url',
      label: t('transcript.info.url'),
      value: info.url
    })
  }
  if (info.description) {
    buckets.media.push({
      key: 'description',
      label: t('download.metadata.description'),
      value: info.description
    })
  }

  if (info.quality) {
    buckets.file.push({
      key: 'quality',
      label: t('download.metadata.quality'),
      value: info.quality
    })
  }
  if (info.format) {
    buckets.file.push({ key: 'format', label: t('download.metadata.format'), value: info.format })
  }
  if (info.codec) {
    buckets.file.push({ key: 'codec', label: t('download.metadata.codec'), value: info.codec })
  }
  if (info.width) {
    buckets.file.push({ key: 'width', label: t('download.metadata.width'), value: info.width })
  }
  if (info.fps) {
    buckets.file.push({ key: 'fps', label: t('download.metadata.fps'), value: info.fps })
  }
  if (info.videoCodec) {
    buckets.file.push({
      key: 'videoCodec',
      label: t('download.metadata.videoCodec'),
      value: info.videoCodec
    })
  }
  if (info.audioCodec) {
    buckets.file.push({
      key: 'audioCodec',
      label: t('download.metadata.audioCodec'),
      value: info.audioCodec
    })
  }
  if (info.formatNote) {
    buckets.file.push({
      key: 'formatNote',
      label: t('download.metadata.formatNote'),
      value: info.formatNote
    })
  }
  if (info.protocol) {
    buckets.file.push({
      key: 'protocol',
      label: t('download.metadata.protocol'),
      value: info.protocol
    })
  }
  if (info.fileName) {
    buckets.file.push({ key: 'file', label: t('transcript.info.file'), value: info.fileName })
  }
  if (info.fileSize && info.fileSize > 0) {
    buckets.file.push({
      key: 'fileSize',
      label: t('transcript.info.fileSize'),
      value: formatBytes(info.fileSize)
    })
  }
  if (info.downloadPath) {
    buckets.file.push({
      key: 'downloadPath',
      label: t('download.metadata.downloadPath'),
      value: info.downloadPath
    })
  }
  if (info.subscription) {
    buckets.file.push({
      key: 'subscription',
      label: t('download.metadata.subscription'),
      value: info.subscription
    })
  }
  if (info.downloadedAt && info.downloadedAt > 0) {
    buckets.file.push({
      key: 'downloadedAt',
      label: t('history.date'),
      value: new Date(info.downloadedAt).toLocaleString()
    })
  }
  if (info.startedAt && info.startedAt > 0) {
    buckets.file.push({
      key: 'startedAt',
      label: t('download.metadata.startedAt'),
      value: new Date(info.startedAt).toLocaleString()
    })
  }
  if (info.completedAt && info.completedAt > 0) {
    buckets.file.push({
      key: 'completedAt',
      label: t('download.metadata.completedAt'),
      value: new Date(info.completedAt).toLocaleString()
    })
  }

  if (info.sourceKind === 'captions' || info.sourceKind === 'asr') {
    buckets.transcript.push({
      key: 'source',
      label: t('transcript.info.source'),
      value:
        info.sourceKind === 'captions' ? t('transcript.sourceCaptions') : t('transcript.sourceAi')
    })
  }
  if (info.sourceKind !== 'captions' && info.asrTier) {
    buckets.transcript.push({
      key: 'model',
      label: t('transcript.info.model'),
      value: isAsrTierId(info.asrTier) ? t(`settings.asrTier.${info.asrTier}.title`) : info.asrTier
    })
  }
  if (info.language) {
    buckets.transcript.push({
      key: 'language',
      label: t('transcript.info.language'),
      value: languageDisplayName(info.language, locale)
    })
  }
  if (info.speakerCount > 0) {
    buckets.transcript.push({
      key: 'speakers',
      label: t('transcript.info.speakers'),
      value: String(info.speakerCount)
    })
  }
  if (info.segmentCount > 0) {
    buckets.transcript.push({
      key: 'segments',
      label: t('transcript.info.segments'),
      value: String(info.segmentCount)
    })
  }
  if (info.createdAt && info.createdAt > 0) {
    buckets.transcript.push({
      key: 'createdAt',
      label: t('transcript.info.createdAt'),
      value: new Date(info.createdAt).toLocaleString()
    })
  }

  return GROUP_ORDER.filter((key) => buckets[key].length > 0).map((key) => ({
    key,
    label: t(`transcript.info.group.${key}`),
    rows: buckets[key]
  }))
}
