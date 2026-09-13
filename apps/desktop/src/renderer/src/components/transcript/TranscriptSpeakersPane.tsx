import { TabUnderline } from '@renderer/components/transcript/TabUnderline'
import { Button } from '@renderer/components/ui/button'
import { formatClock } from '@renderer/lib/format-clock'
import {
  buildSpeakerTimelines,
  playheadPercent,
  rangePosition,
  type SpeakerTimelineRow,
  speakerColor,
  speakingSharePercent
} from '@renderer/lib/transcript-speakers'
import { cn } from '@renderer/lib/utils'
import type { TranscriptSegmentView, TranscriptSpeakerView } from '@renderer/store/transcripts'
import { Users } from 'lucide-react'
import { type MouseEvent, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SpeakerAvatar } from './SpeakerAvatar'
import {
  hasTranscriptInfo,
  type TranscriptInfoFields,
  TranscriptInfoPane
} from './TranscriptInfoPane'

interface TranscriptSpeakersPaneProps {
  canAdjustSpeakers?: boolean
  compact?: boolean
  currentSpeakerId: string | null
  currentTimeMs: number
  durationMs: number
  info?: TranscriptInfoFields
  onAdjustSpeakers?: () => void
  onSeek: (seconds: number) => void
  resolveSpeaker: (speakerId: string | null) => string
  segments: TranscriptSegmentView[]
  speakers: TranscriptSpeakerView[]
}

/**
 * Show speaker talking-time shares, a clickable speech timeline, and an Info tab.
 *
 * The pane keeps a min height so a portrait video frame cannot flex-shrink it away.
 */
export function TranscriptSpeakersPane({
  canAdjustSpeakers = false,
  compact = false,
  currentSpeakerId,
  currentTimeMs,
  durationMs,
  info,
  onAdjustSpeakers,
  onSeek,
  resolveSpeaker,
  segments,
  speakers
}: TranscriptSpeakersPaneProps) {
  const { t } = useTranslation()
  const rows = useMemo(() => buildSpeakerTimelines(speakers, segments), [segments, speakers])
  const [tabOverride, setTabOverride] = useState<'speakers' | 'info' | null>(null)
  const showSpeakerTab = rows.length > 0
  const showInfoTab = Boolean(info && hasTranscriptInfo(info))
  const activeTab = tabOverride ?? (showSpeakerTab ? 'speakers' : 'info')
  if (compact) {
    if (!showSpeakerTab) {
      return null
    }
    return (
      <CompactSpeakerStrip
        canAdjustSpeakers={canAdjustSpeakers}
        currentSpeakerId={currentSpeakerId}
        onAdjustSpeakers={onAdjustSpeakers}
        onSeek={onSeek}
        resolveSpeaker={resolveSpeaker}
        rows={rows}
      />
    )
  }

  if (!(showSpeakerTab || showInfoTab)) {
    return null
  }

  return (
    <section
      className="min-h-48 flex-1 overflow-y-auto border-border/60 border-t bg-background"
      data-testid="transcript-speakers"
    >
      <div className="sticky top-0 z-10 border-border/60 border-b bg-background px-4">
        <div className="relative flex items-center gap-4" role="tablist">
          <TabUnderline activeId={activeTab} />
          {showSpeakerTab ? (
            <TabButton
              active={activeTab === 'speakers'}
              label={t('transcript.speakers', { count: rows.length })}
              onSelect={() => setTabOverride('speakers')}
              value="speakers"
            />
          ) : null}
          {showInfoTab ? (
            <TabButton
              active={activeTab === 'info'}
              label={t('transcript.info.tab')}
              onSelect={() => setTabOverride('info')}
              value="info"
            />
          ) : null}
          {canAdjustSpeakers ? (
            <Button
              className="ml-auto h-6 px-2"
              data-testid="transcript-adjust-speakers"
              onClick={onAdjustSpeakers}
              size="sm"
              type="button"
              variant="outline"
            >
              {t('transcript.speakerCount.adjust')}
            </Button>
          ) : null}
        </div>
      </div>
      {activeTab === 'info' && info ? (
        <TranscriptInfoPane {...info} />
      ) : (
        <SpeakerTimelineList
          currentSpeakerId={currentSpeakerId}
          currentTimeMs={currentTimeMs}
          durationMs={durationMs}
          onSeek={onSeek}
          resolveSpeaker={resolveSpeaker}
          rows={rows}
        />
      )}
    </section>
  )
}

interface TabButtonProps {
  active: boolean
  label: string
  onSelect: () => void
  value: string
}

/**
 * Underline tab used in the media details header.
 */
function TabButton({ active, label, onSelect, value }: TabButtonProps) {
  return (
    <button
      aria-selected={active}
      className={cn(
        'cursor-pointer border-transparent border-b-2 pt-3 pb-2 font-medium text-sm transition-colors duration-200',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
      data-tab-id={value}
      data-testid={`transcript-tab-${value}`}
      onClick={onSelect}
      role="tab"
      type="button"
      value={value}
    >
      {label}
    </button>
  )
}

interface CompactSpeakerStripProps {
  canAdjustSpeakers?: boolean
  currentSpeakerId: string | null
  onAdjustSpeakers?: () => void
  onSeek: (seconds: number) => void
  resolveSpeaker: (speakerId: string | null) => string
  rows: SpeakerTimelineRow[]
}

/**
 * Horizontal speaker chips for the stacked (narrow) transcript layout.
 */
function CompactSpeakerStrip({
  canAdjustSpeakers = false,
  currentSpeakerId,
  onAdjustSpeakers,
  onSeek,
  resolveSpeaker,
  rows
}: CompactSpeakerStripProps) {
  const { t } = useTranslation()
  return (
    <div className="shrink-0 border-border/60 border-t bg-background px-3 py-2">
      <div className="flex items-center gap-2 overflow-x-auto">
        {canAdjustSpeakers ? (
          <Button
            aria-label={t('transcript.speakerCount.adjust')}
            className="size-7 shrink-0"
            data-testid="transcript-adjust-speakers"
            onClick={onAdjustSpeakers}
            size="icon"
            type="button"
            variant="outline"
          >
            <Users className="size-3.5" />
          </Button>
        ) : null}
        {rows.map((row) => {
          const name = resolveSpeaker(row.speakerId)
          const current = currentSpeakerId === row.speakerId
          return (
            <button
              className={cn(
                'flex shrink-0 cursor-pointer items-center gap-2 rounded-full border px-2 py-1 text-left transition-colors',
                current
                  ? 'border-border bg-muted'
                  : 'border-transparent hover:border-border hover:bg-muted/70'
              )}
              data-testid={`transcript-speaker-${row.speakerId}`}
              key={row.speakerId}
              onClick={() => onSeek(row.ranges[0] ? row.ranges[0].startMs / 1000 : 0)}
              type="button"
            >
              <SpeakerAvatar current={current} name={name} size="xs" sortIndex={row.sortIndex} />
              <span className="max-w-28 truncate font-medium text-xs">{name}</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {t('transcript.speakingShare', { percent: speakingSharePercent(row.share) })}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface SpeakerTimelineListProps {
  currentSpeakerId: string | null
  currentTimeMs: number
  durationMs: number
  onSeek: (seconds: number) => void
  resolveSpeaker: (speakerId: string | null) => string
  rows: SpeakerTimelineRow[]
}

/**
 * Full speaker list with talking-time shares and seekable range tracks.
 */
function SpeakerTimelineList({
  currentSpeakerId,
  currentTimeMs,
  durationMs,
  onSeek,
  resolveSpeaker,
  rows
}: SpeakerTimelineListProps) {
  const { t } = useTranslation()
  const playhead = playheadPercent(currentTimeMs, durationMs)
  return (
    <ul className="divide-y divide-border/50">
      {rows.map((row) => {
        const name = resolveSpeaker(row.speakerId)
        const color = speakerColor(row.sortIndex)
        const current = currentSpeakerId === row.speakerId
        const firstRange = row.ranges[0]
        return (
          <li
            className={cn('px-4 py-3 transition-colors', current ? 'bg-muted/50' : '')}
            key={row.speakerId}
          >
            <button
              aria-label={t('transcript.seekSpeaker', { name })}
              className="flex w-full cursor-pointer items-center gap-2 text-left"
              onClick={() => onSeek(firstRange ? firstRange.startMs / 1000 : 0)}
              type="button"
            >
              <SpeakerAvatar current={current} name={name} size="xs" sortIndex={row.sortIndex} />
              <span className="min-w-0 flex-1 truncate font-medium text-sm">{name}</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {t('transcript.speakingShare', { percent: speakingSharePercent(row.share) })}
              </span>
            </button>
            <button
              aria-label={t('transcript.seekAt', {
                time: formatClock(currentTimeMs / 1000)
              })}
              className="relative mt-2 block h-6 w-full cursor-pointer"
              onClick={(event) => handleTrackSeek(event, durationMs, onSeek)}
              type="button"
            >
              <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
              {row.ranges.map((range) => {
                const position = rangePosition(range, durationMs)
                return (
                  <span
                    className={cn(
                      'absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full',
                      color.bar
                    )}
                    key={`${range.startMs}-${range.endMs}`}
                    style={position}
                  />
                )
              })}
              <span
                className="absolute top-1 bottom-1 w-0.5 rounded-full bg-foreground/70"
                style={{ left: `${playhead}%` }}
              />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Seek to the clicked position on a speaker timeline track.
 */
const handleTrackSeek = (
  event: MouseEvent<HTMLButtonElement>,
  durationMs: number,
  onSeek: (seconds: number) => void
): void => {
  if (durationMs <= 0) {
    return
  }
  const rect = event.currentTarget.getBoundingClientRect()
  if (rect.width <= 0) {
    return
  }
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  onSeek((ratio * durationMs) / 1000)
}
