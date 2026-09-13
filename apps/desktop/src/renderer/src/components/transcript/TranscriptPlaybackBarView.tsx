import { TranscriptPlaybackSlot } from '@renderer/components/transcript/TranscriptPlaybackSlot'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { RemoteImage } from '@renderer/components/ui/remote-image'
import { formatClock } from '@renderer/lib/format-clock'
import {
  DEFAULT_PLAYBACK_RATE,
  formatPlaybackRate,
  PLAYBACK_BAR_CONTROL_CLASS,
  PLAYBACK_BAR_HEIGHT_PX,
  PLAYBACK_RATES,
  playbackBarCoverRatio,
  playbackSeekPercent,
  playbackSeekTimeFromClientX
} from '@renderer/lib/transcript-playback'
import { readImageAspectRatio } from '@renderer/lib/transcript-player-frame'
import { cn } from '@renderer/lib/utils'
import { FileAudio, Pause, Play, Volume1, Volume2, VolumeX } from 'lucide-react'
import { type CSSProperties, type PointerEvent, type ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface TranscriptPlaybackBarViewProps {
  compact?: boolean
  currentLine: string | null
  currentTime: number
  duration: number
  isAudio: boolean
  muted?: boolean
  onOpen: () => void
  onPlaybackRateChange?: (rate: number) => void
  onSeek: (seconds: number) => void
  onToggleMute?: () => void
  onToggle: () => void
  onVolumeChange?: (volume: number) => void
  playbackRate?: number
  playlistControl?: ReactNode
  playing: boolean
  thumbnail: string | null
  title: string
  videoRatio?: number | null
  volume?: number
}

/**
 * Crossfade Lucide play and pause with a shared rotation so the swap stays in family.
 */
function PlaybackToggleIcon({ playing }: { playing: boolean }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className="transcript-playback-bar-toggle-icons"
      data-playing={playing ? 'true' : 'false'}
    >
      <Play data-icon="play" />
      <Pause data-icon="pause" />
    </span>
  )
}

/**
 * Render the speaker icon that matches the current volume state.
 */
function VolumeGlyph({ muted, volume }: { muted: boolean; volume: number }): ReactNode {
  if (muted || volume === 0) {
    return <VolumeX className="size-5" />
  }
  if (volume < 0.5) {
    return <Volume1 className="size-5" />
  }
  return <Volume2 className="size-5" />
}

/**
 * Presentational now-playing bar.
 *
 * Home-style pages use `px-6` to match list content. Transcript detail uses
 * `px-4` so the art lines up with speakers and captions, and the shell
 * collapses the bar to the seek strip until hover.
 */
export function TranscriptPlaybackBarView({
  compact = false,
  currentLine,
  currentTime,
  duration,
  isAudio,
  muted = false,
  onOpen,
  onPlaybackRateChange,
  onSeek,
  onToggleMute,
  onToggle,
  onVolumeChange,
  playbackRate = DEFAULT_PLAYBACK_RATE,
  playlistControl,
  playing,
  thumbnail,
  title,
  videoRatio = null,
  volume = 1
}: TranscriptPlaybackBarViewProps): ReactNode {
  const { t } = useTranslation()
  const coverRef = useRef<HTMLDivElement>(null)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [imageRatio, setImageRatio] = useState<number | null>(null)
  const [rateOpen, setRateOpen] = useState(false)
  const rateLabel = formatPlaybackRate(playbackRate)
  const max = duration > 0 ? duration : 0
  const percent = playbackSeekPercent(currentTime, duration)
  const previewTime = hoverTime ?? currentTime
  const previewPercent = playbackSeekPercent(previewTime, duration)
  const coverRatio = playbackBarCoverRatio({ imageRatio, isAudio, videoRatio })
  const playLabel = playing ? t('transcript.player.pause') : t('transcript.player.play')
  const displayedVolume = muted ? 0 : volume
  const volumePercent = Math.round(displayedVolume * 100)
  const volumeLabel = muted ? t('transcript.player.unmute') : t('transcript.player.mute')

  /**
   * Preview the time under the pointer without committing a seek.
   */
  const onSeekPointerMove = (event: PointerEvent<HTMLInputElement>): void => {
    setHoverTime(
      playbackSeekTimeFromClientX(
        event.clientX,
        event.currentTarget.getBoundingClientRect(),
        duration
      )
    )
  }

  return (
    <div
      className="transcript-playback-bar relative shrink-0 bg-background"
      data-inset={compact ? 'detail' : 'home'}
      data-testid="transcript-playback-bar"
      style={{ height: PLAYBACK_BAR_HEIGHT_PX }}
    >
      <div className="transcript-playback-bar-seek-wrap">
        <div aria-hidden="true" className="transcript-playback-bar-seek-track">
          <div
            className="transcript-playback-bar-seek-fill"
            data-testid="transcript-playback-bar-seek-fill"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div
          aria-hidden="true"
          className="transcript-playback-bar-seek-thumb"
          data-testid="transcript-playback-bar-seek-thumb"
          style={{ left: `${percent}%` }}
        />
        <div
          aria-hidden="true"
          className="transcript-playback-bar-seek-time"
          data-testid="transcript-playback-bar-seek-time"
          style={{ '--seek-preview': `${previewPercent}%` } as CSSProperties}
        >
          {formatClock(previewTime)} / {formatClock(duration)}
        </div>
        <input
          aria-label={t('transcript.player.seek')}
          aria-valuemax={max}
          aria-valuemin={0}
          aria-valuenow={Math.min(currentTime, max)}
          className="transcript-playback-bar-seek"
          data-testid="transcript-playback-bar-seek"
          disabled={max <= 0}
          max={max}
          min={0}
          onChange={(event) => {
            onSeek(Number(event.target.value))
          }}
          onPointerDown={onSeekPointerMove}
          onPointerLeave={() => {
            setHoverTime(null)
          }}
          onPointerMove={onSeekPointerMove}
          step={0.1}
          type="range"
          value={Math.min(currentTime, max)}
        />
      </div>
      <div className="transcript-playback-bar-inset flex h-full items-center gap-4">
        <div
          className="relative h-12 max-w-36 shrink-0 overflow-hidden rounded bg-muted"
          data-testid="transcript-playback-bar-cover"
          ref={coverRef}
          style={{ aspectRatio: String(coverRatio) }}
        >
          {isAudio ? (
            <RemoteImage
              alt=""
              className="h-full w-full object-contain [&_img]:object-contain"
              fallbackIcon={<FileAudio className="h-6 w-6 text-primary" />}
              onLoadingChange={(loading) => {
                if (loading) {
                  setImageRatio(null)
                  return
                }
                setImageRatio(readImageAspectRatio(coverRef.current?.querySelector('img')))
              }}
              src={thumbnail ?? undefined}
            />
          ) : (
            <TranscriptPlaybackSlot className="h-full w-full" slot="bar" />
          )}
          <button
            aria-label={t('transcript.player.openTranscript')}
            className="absolute inset-0 cursor-pointer"
            onClick={onOpen}
            type="button"
          />
        </div>
        <button className="min-w-0 flex-1 cursor-pointer text-left" onClick={onOpen} type="button">
          <p className="truncate font-medium text-[15px] leading-5">{title}</p>
          <p className="truncate text-[13px] text-muted-foreground leading-4">
            {currentLine || t('transcript.player.nowPlaying')}
          </p>
        </button>
        <span className="hidden shrink-0 text-[13px] text-muted-foreground tabular-nums sm:block">
          {formatClock(currentTime)} / {formatClock(duration)}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            aria-label={playLabel}
            className={PLAYBACK_BAR_CONTROL_CLASS}
            data-testid="transcript-playback-bar-toggle"
            onClick={onToggle}
            size="icon"
            type="button"
            variant="ghost"
          >
            <PlaybackToggleIcon playing={playing} />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                aria-label={t('transcript.player.volume')}
                className={PLAYBACK_BAR_CONTROL_CLASS}
                data-testid="transcript-playback-bar-volume-trigger"
                size="icon"
                type="button"
                variant="ghost"
              >
                <VolumeGlyph muted={muted} volume={volume} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="center" className="w-16 p-2" side="top" sideOffset={12}>
              <div className="flex flex-col items-center gap-2">
                <span className="text-muted-foreground text-xs tabular-nums">
                  {t('transcript.player.volumePercent', { percent: volumePercent })}
                </span>
                <input
                  aria-label={t('transcript.player.volume')}
                  aria-orientation="vertical"
                  aria-valuetext={t('transcript.player.volumePercent', { percent: volumePercent })}
                  className="transcript-playback-bar-volume"
                  data-testid="transcript-playback-bar-volume"
                  max={1}
                  min={0}
                  onChange={(event) => {
                    onVolumeChange?.(Number(event.target.value))
                  }}
                  step={0.01}
                  style={{ '--volume-percent': `${volumePercent}%` } as CSSProperties}
                  type="range"
                  value={displayedVolume}
                />
                <Button
                  aria-label={volumeLabel}
                  className="h-8 w-8 shrink-0"
                  data-testid="transcript-playback-bar-mute"
                  onClick={onToggleMute}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <VolumeGlyph muted={muted} volume={volume} />
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Popover onOpenChange={setRateOpen} open={rateOpen}>
            <PopoverTrigger asChild>
              <Button
                aria-label={t('transcript.player.playbackRate')}
                className={cn(PLAYBACK_BAR_CONTROL_CLASS, 'text-[15px] leading-none')}
                data-testid="transcript-playback-bar-rate"
                size="icon"
                type="button"
                variant="ghost"
              >
                <span className="font-medium text-[15px] tabular-nums leading-none">
                  {t('transcript.player.playbackRateValue', { rate: rateLabel })}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="center" className="w-24 p-1" side="top" sideOffset={12}>
              <div className="flex flex-col">
                {PLAYBACK_RATES.map((rate) => {
                  const selected = rate === playbackRate
                  return (
                    <button
                      aria-pressed={selected}
                      className={cn(
                        'rounded-sm px-2 py-1.5 text-center text-sm tabular-nums',
                        selected
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-foreground hover:bg-accent/60'
                      )}
                      data-testid={`transcript-playback-bar-rate-${rate}`}
                      key={rate}
                      onClick={() => {
                        onPlaybackRateChange?.(rate)
                        setRateOpen(false)
                      }}
                      type="button"
                    >
                      {t('transcript.player.playbackRateValue', {
                        rate: formatPlaybackRate(rate)
                      })}
                    </button>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
          {playlistControl}
        </div>
      </div>
    </div>
  )
}
