import { TranscriptAudioStage } from '@renderer/components/transcript/TranscriptAudioStage'
import { TranscriptPlayerNotice } from '@renderer/components/transcript/TranscriptPlayerNotice'
import { formatPlayerClock } from '@renderer/lib/format-clock'
import { mediaMimeType } from '@renderer/lib/local-file-src'
import { clampPlaybackRate, DEFAULT_PLAYBACK_RATE } from '@renderer/lib/transcript-playback'
import {
  DEFAULT_VIDEO_ASPECT_RATIO,
  readVideoAspectRatio,
  transcriptPlayerAspectStyle
} from '@renderer/lib/transcript-player-frame'
import { cn } from '@renderer/lib/utils'
import type {
  TranscriptPlaybackVolume,
  TranscriptPlayerControls
} from '@renderer/store/transcript-playback'
import { useMedia } from '@videojs/react'
import { Audio, AudioPlayer, AudioSkin, usePlayer as useAudioPlayer } from '@videojs/react/audio'
import { usePlayer as useVideoPlayer, Video, VideoPlayer, VideoSkin } from '@videojs/react/video'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import '@videojs/react/audio/skin.css'
import '@videojs/react/video/skin.css'
import './transcript-player.css'

const PLAYER_HOST_CLASS = 'transcript-player-host flex w-full justify-center'
const DEFAULT_MEDIA_VOLUME: TranscriptPlaybackVolume = { muted: false, volume: 1 }
type MediaControls = Omit<TranscriptPlayerControls, 'seek'>

export type TranscriptPlayerChrome = 'full' | 'mini'

interface TranscriptPlayerFrameProps {
  aspectRatio?: number
  children: ReactNode
  chrome?: TranscriptPlayerChrome
  relative?: boolean
  variant?: 'audio' | 'video'
}

/**
 * Size the video window to the source aspect ratio, or a listening card for audio.
 */
function TranscriptPlayerFrame({
  aspectRatio = DEFAULT_VIDEO_ASPECT_RATIO,
  children,
  chrome = 'full',
  relative = false,
  variant = 'video'
}: TranscriptPlayerFrameProps): ReactNode {
  const isAudio = variant === 'audio'
  const isMini = chrome === 'mini'
  return (
    <div
      className={cn(
        PLAYER_HOST_CLASS,
        isMini
          ? 'h-full min-h-0 overflow-hidden'
          : isAudio
            ? 'h-full min-h-0'
            : 'max-h-full min-h-0 overflow-hidden'
      )}
    >
      <div
        className={cn(
          'transcript-player',
          isMini && 'transcript-player--mini h-full min-h-0 w-full overflow-hidden bg-black',
          !isMini && isAudio && 'transcript-player--audio flex h-full min-h-0 w-full flex-col',
          !(isMini || isAudio) && 'transcript-player--fit min-h-0 bg-black',
          relative && 'relative'
        )}
        style={isMini || isAudio ? undefined : transcriptPlayerAspectStyle(aspectRatio)}
      >
        {children}
      </div>
    </div>
  )
}

interface TranscriptVideoJsPlayerProps {
  captionsSrc: string | null
  chrome?: TranscriptPlayerChrome
  currentSpeakerName?: string | null
  currentSpeakerSortIndex?: number | null
  isAudio: boolean
  onAspectRatio?: (ratio: number) => void
  onControlsReady?: (controls: MediaControls) => void
  onEnded?: () => void
  onPlaybackRate?: (rate: number) => void
  onPlaying?: (playing: boolean) => void
  onRetryPrepare?: () => void
  onSeekReady: (seek: (seconds: number) => void) => void
  onTime: (currentTime: number, duration: number) => void
  onVolume?: (state: TranscriptPlaybackVolume) => void
  playbackRate?: number
  prepareError?: string | null
  preparing?: boolean
  src: string | null
  subtitle?: string | null
  thumbnail?: string | null
  title: string
  volumeState?: TranscriptPlaybackVolume
}

interface PlayerClockBridgeProps {
  onSeekReady: (seek: (seconds: number) => void) => void
  onTime: (currentTime: number, duration: number) => void
}

interface PlayerClockState {
  currentTime: number
  duration: number
  seek?: (time: number) => unknown
}

/**
 * Seek through the Video.js store and the media element.
 *
 * Store.seek can no-op before attach; setting currentTime covers that case.
 */
const seekPlayer = (store: PlayerClockState, media: unknown, seconds: number): void => {
  if (typeof store.seek === 'function') {
    void store.seek(seconds)
  }
  if (media && typeof media === 'object' && 'currentTime' in media) {
    const element = media as { currentTime: number }
    element.currentTime = seconds
  }
}

/**
 * Read currentTime/duration from a Video.js store snapshot.
 */
const readPlayerClock = (state: unknown): Pick<PlayerClockState, 'currentTime' | 'duration'> => {
  const clock = state as { currentTime?: unknown; duration?: unknown }
  return {
    currentTime: typeof clock.currentTime === 'number' ? clock.currentTime : 0,
    duration: typeof clock.duration === 'number' ? clock.duration : 0
  }
}

/**
 * Render a hidden clock for screen readers.
 */
function TranscriptClock({
  currentTime,
  duration
}: {
  currentTime: number
  duration: number
}): ReactNode {
  return (
    <span className="sr-only">
      {formatPlayerClock(currentTime)} / {formatPlayerClock(duration)}
    </span>
  )
}

/**
 * Read a Video.js media error message from the player store.
 */
const readPlayerError = (state: unknown): string | null => {
  const snapshot = state as { error?: unknown }
  if (typeof snapshot.error === 'string' && snapshot.error.length > 0) {
    return snapshot.error
  }
  if (
    snapshot.error &&
    typeof snapshot.error === 'object' &&
    'message' in snapshot.error &&
    typeof snapshot.error.message === 'string' &&
    snapshot.error.message.length > 0
  ) {
    return snapshot.error.message
  }
  return null
}

/**
 * Read a native media element error, used when Video.js store state is empty.
 */
const readMediaElementError = (media: unknown): string | null => {
  if (!media || typeof media !== 'object' || !('error' in media)) {
    return null
  }
  const mediaError = media.error as { code?: number; message?: string } | null
  if (!mediaError) {
    return null
  }
  if (typeof mediaError.message === 'string' && mediaError.message.length > 0) {
    return mediaError.message
  }
  return typeof mediaError.code === 'number' ? `media-error-${mediaError.code}` : 'media-error'
}

/**
 * Report Video.js playback failures so the transcript page can show its own copy.
 */
function VideoErrorBridge({ onError }: { onError: (message: string | null) => void }): ReactNode {
  const message = useVideoPlayer(readPlayerError)
  const media = useMedia()
  useEffect(() => {
    const report = (): void => {
      onError(message ?? readMediaElementError(media))
    }
    report()
    if (!media || typeof media !== 'object' || !('addEventListener' in media)) {
      return
    }
    const node = media as HTMLMediaElement
    node.addEventListener('error', report)
    return () => {
      node.removeEventListener('error', report)
    }
  }, [media, message, onError])
  return null
}

/**
 * Report audio playback failures so the transcript page can show its own copy.
 */
function AudioErrorBridge({ onError }: { onError: (message: string | null) => void }): ReactNode {
  const message = useAudioPlayer(readPlayerError)
  const media = useMedia()
  useEffect(() => {
    const report = (): void => {
      onError(message ?? readMediaElementError(media))
    }
    report()
    if (!media || typeof media !== 'object' || !('addEventListener' in media)) {
      return
    }
    const node = media as HTMLMediaElement
    node.addEventListener('error', report)
    return () => {
      node.removeEventListener('error', report)
    }
  }, [media, message, onError])
  return null
}

/**
 * Push native media seek/time events into the transcript clock.
 */
const bindMediaClock = (
  media: unknown,
  onTime: (currentTime: number, duration: number) => void
): (() => void) | undefined => {
  if (!media || typeof media !== 'object' || !('addEventListener' in media)) {
    return
  }
  const node = media as HTMLMediaElement
  const report = (): void => {
    const nextDuration = Number.isFinite(node.duration) ? node.duration : 0
    onTime(node.currentTime, nextDuration)
  }
  node.addEventListener('seeked', report)
  node.addEventListener('timeupdate', report)
  return () => {
    node.removeEventListener('seeked', report)
    node.removeEventListener('timeupdate', report)
  }
}

/**
 * Sync the video store clock into the transcript list.
 */
function VideoClockBridge({ onSeekReady, onTime }: PlayerClockBridgeProps): ReactNode {
  const { currentTime, duration } = useVideoPlayer(readPlayerClock)
  const store = useVideoPlayer() as unknown as PlayerClockState
  const media = useMedia()
  useEffect(() => {
    onSeekReady((seconds: number) => {
      seekPlayer(store, media, seconds)
    })
  }, [media, onSeekReady, store])

  useEffect(() => {
    onTime(currentTime, duration)
  }, [currentTime, duration, onTime])

  useEffect(() => bindMediaClock(media, onTime), [media, onTime])
  return <TranscriptClock currentTime={currentTime} duration={duration} />
}

/**
 * Keep the video window matched to the source width÷height.
 */
function VideoAspectBridge({
  onAspectRatio
}: {
  onAspectRatio: (ratio: number) => void
}): ReactNode {
  const media = useMedia()
  useEffect(() => {
    if (!media || typeof media !== 'object' || !('addEventListener' in media)) {
      return
    }
    const node = media as HTMLVideoElement
    const report = (): void => {
      const ratio = readVideoAspectRatio(node)
      if (ratio) {
        onAspectRatio(ratio)
      }
    }
    report()
    node.addEventListener('loadeddata', report)
    node.addEventListener('loadedmetadata', report)
    node.addEventListener('resize', report)
    return () => {
      node.removeEventListener('loadeddata', report)
      node.removeEventListener('loadedmetadata', report)
      node.removeEventListener('resize', report)
    }
  }, [media, onAspectRatio])

  return null
}

/**
 * Sync the audio store clock into the transcript list.
 */
function AudioClockBridge({ onSeekReady, onTime }: PlayerClockBridgeProps): ReactNode {
  const { currentTime, duration } = useAudioPlayer(readPlayerClock)
  const store = useAudioPlayer() as unknown as PlayerClockState
  const media = useMedia()
  useEffect(() => {
    onSeekReady((seconds: number) => {
      seekPlayer(store, media, seconds)
    })
  }, [media, onSeekReady, store])

  useEffect(() => {
    onTime(currentTime, duration)
  }, [currentTime, duration, onTime])

  useEffect(() => bindMediaClock(media, onTime), [media, onTime])
  return <TranscriptClock currentTime={currentTime} duration={duration} />
}

/**
 * Report whether a media element is currently playing.
 */
const bindMediaPlaying = (
  media: unknown,
  onPlaying: (playing: boolean) => void
): (() => void) | undefined => {
  if (!media || typeof media !== 'object' || !('addEventListener' in media)) {
    onPlaying(false)
    return
  }
  const node = media as HTMLMediaElement
  const report = (): void => {
    onPlaying(!node.paused)
  }
  report()
  node.addEventListener('ended', report)
  node.addEventListener('pause', report)
  node.addEventListener('play', report)
  return () => {
    node.removeEventListener('ended', report)
    node.removeEventListener('pause', report)
    node.removeEventListener('play', report)
  }
}

/**
 * Expose play/pause on the live media element.
 */
const bindMediaControls = (
  media: unknown,
  onControlsReady: (controls: MediaControls) => void
): void => {
  if (!media || typeof media !== 'object' || !('play' in media) || !('pause' in media)) {
    return
  }
  const node = media as HTMLMediaElement
  const play = (): void => {
    void node.play()?.catch(() => undefined)
  }
  const pause = (): void => {
    node.pause()
  }
  onControlsReady({
    pause,
    play,
    setPlaybackRate: (rate: number) => {
      const next = clampPlaybackRate(rate)
      node.defaultPlaybackRate = next
      node.playbackRate = next
    },
    setVolume: (volume: number) => {
      node.volume = Math.min(1, Math.max(0, volume))
      if (volume > 0) {
        node.muted = false
      }
    },
    toggle: () => {
      if (node.paused) {
        play()
        return
      }
      pause()
    },
    toggleMute: () => {
      node.muted = !node.muted
    }
  })
}

/**
 * Keep the shared volume state synchronized with the native media element.
 */
function MediaVolumeBridge({
  onVolume,
  volumeState = DEFAULT_MEDIA_VOLUME
}: {
  onVolume: (state: TranscriptPlaybackVolume) => void
  volumeState: TranscriptPlaybackVolume
}): ReactNode {
  const media = useMedia()
  useEffect(() => {
    if (!media || typeof media !== 'object' || !('volume' in media) || !('muted' in media)) {
      return
    }
    const node = media as HTMLMediaElement
    node.volume = volumeState.volume
    node.muted = volumeState.muted
  }, [media, volumeState.muted, volumeState.volume])

  useEffect(() => {
    if (
      !media ||
      typeof media !== 'object' ||
      !('addEventListener' in media) ||
      !('volume' in media) ||
      !('muted' in media)
    ) {
      return
    }
    const node = media as HTMLMediaElement
    const report = (): void => {
      onVolume({ muted: node.muted, volume: node.volume })
    }
    report()
    node.addEventListener('volumechange', report)
    return () => {
      node.removeEventListener('volumechange', report)
    }
  }, [media, onVolume])
  return null
}

/**
 * Keep the shared playback rate synchronized with the native media element.
 */
function MediaPlaybackRateBridge({
  onPlaybackRate,
  playbackRate = DEFAULT_PLAYBACK_RATE
}: {
  onPlaybackRate: (rate: number) => void
  playbackRate: number
}): ReactNode {
  const media = useMedia()
  useEffect(() => {
    if (!media || typeof media !== 'object' || !('playbackRate' in media)) {
      return
    }
    const node = media as HTMLMediaElement
    const next = clampPlaybackRate(playbackRate)
    node.defaultPlaybackRate = next
    node.playbackRate = next
  }, [media, playbackRate])

  useEffect(() => {
    if (
      !media ||
      typeof media !== 'object' ||
      !('addEventListener' in media) ||
      !('playbackRate' in media)
    ) {
      return
    }
    const node = media as HTMLMediaElement
    const report = (): void => {
      onPlaybackRate(clampPlaybackRate(node.playbackRate))
    }
    report()
    node.addEventListener('ratechange', report)
    return () => {
      node.removeEventListener('ratechange', report)
    }
  }, [media, onPlaybackRate])
  return null
}

/**
 * Report whether the audio element is currently playing.
 */
function AudioPlayingBridge({ onPlaying }: { onPlaying: (playing: boolean) => void }): ReactNode {
  const media = useMedia()
  useEffect(() => bindMediaPlaying(media, onPlaying), [media, onPlaying])
  return null
}

/**
 * Report whether the video element is currently playing.
 */
function VideoPlayingBridge({ onPlaying }: { onPlaying: (playing: boolean) => void }): ReactNode {
  const media = useMedia()
  useEffect(() => bindMediaPlaying(media, onPlaying), [media, onPlaying])
  return null
}

/**
 * Notify the shared queue when the active native media reaches its end.
 */
function MediaEndedBridge({ onEnded }: { onEnded: () => void }): ReactNode {
  const media = useMedia()
  useEffect(() => {
    if (!media || typeof media !== 'object' || !('addEventListener' in media)) {
      return
    }
    const node = media as HTMLMediaElement
    node.addEventListener('ended', onEnded)
    return () => {
      node.removeEventListener('ended', onEnded)
    }
  }, [media, onEnded])
  return null
}

/**
 * Push play/pause onto the transcript host from the audio element.
 */
function AudioControlsBridge({
  onControlsReady
}: {
  onControlsReady: (controls: MediaControls) => void
}): ReactNode {
  const media = useMedia()
  useEffect(() => {
    bindMediaControls(media, onControlsReady)
  }, [media, onControlsReady])
  return null
}

/**
 * Push play/pause onto the transcript host from the video element.
 */
function VideoControlsBridge({
  onControlsReady
}: {
  onControlsReady: (controls: MediaControls) => void
}): ReactNode {
  const media = useMedia()
  useEffect(() => {
    bindMediaControls(media, onControlsReady)
  }, [media, onControlsReady])
  return null
}

/**
 * In-page Video.js v10 player for transcript media, including captions and chrome.
 */
export function TranscriptVideoJsPlayer({
  captionsSrc,
  chrome = 'full',
  currentSpeakerName = null,
  currentSpeakerSortIndex = null,
  isAudio,
  onAspectRatio,
  onControlsReady,
  onEnded,
  onPlaybackRate,
  onPlaying,
  onRetryPrepare,
  onSeekReady,
  onTime,
  onVolume,
  playbackRate = DEFAULT_PLAYBACK_RATE,
  prepareError = null,
  preparing = false,
  src,
  subtitle = null,
  thumbnail = null,
  title,
  volumeState = DEFAULT_MEDIA_VOLUME
}: TranscriptVideoJsPlayerProps): ReactNode {
  const { t } = useTranslation()
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [playbackAttempt, setPlaybackAttempt] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [videoAspect, setVideoAspect] = useState(DEFAULT_VIDEO_ASPECT_RATIO)
  const handleAspectRatio = useCallback(
    (ratio: number) => {
      setVideoAspect(ratio)
      onAspectRatio?.(ratio)
    },
    [onAspectRatio]
  )
  const frameVariant = isAudio ? 'audio' : 'video'
  useEffect(() => {
    setPlaybackError(null)
    setPlaying(false)
    setVideoAspect(DEFAULT_VIDEO_ASPECT_RATIO)
    setPlaybackAttempt(0)
    if (!src) {
      return
    }
  }, [src])
  const captions = captionsSrc ? (
    <track kind="captions" label={t('transcript.title')} src={captionsSrc} />
  ) : null
  const mimeType = src ? mediaMimeType(src) : undefined
  const mediaSource = src ? <source src={src} type={mimeType} /> : null
  const failedTitle = isAudio
    ? t('transcript.player.failedAudioTitle')
    : t('transcript.player.failedTitle')
  const failedNotice = (
    <TranscriptPlayerNotice
      detail={t('transcript.player.failedDetail')}
      onRetry={
        prepareError
          ? onRetryPrepare
          : () => {
              setPlaybackError(null)
              setPlaybackAttempt((current) => current + 1)
            }
      }
      retryLabel={t('transcript.player.retry')}
      title={failedTitle}
      variant={frameVariant}
    />
  )

  const handlePlaying = useCallback(
    (nextPlaying: boolean) => {
      setPlaying(nextPlaying)
      onPlaying?.(nextPlaying)
    },
    [onPlaying]
  )
  const showFailure = chrome === 'full' && playbackError
  if (!src) {
    return (
      <TranscriptPlayerFrame aspectRatio={videoAspect} chrome={chrome} variant={frameVariant}>
        {chrome === 'mini' ? null : prepareError ? (
          failedNotice
        ) : (
          <TranscriptPlayerNotice
            title={preparing ? t('transcript.player.preparing') : t('transcript.mediaMissing')}
            variant={frameVariant}
          />
        )}
      </TranscriptPlayerFrame>
    )
  }

  if (isAudio) {
    return (
      <TranscriptPlayerFrame chrome={chrome} relative variant="audio">
        <AudioPlayer key={`${src}:${playbackAttempt}`}>
          <div className="flex h-full min-h-0 w-full flex-col">
            <TranscriptAudioStage
              currentSpeakerName={currentSpeakerName}
              currentSpeakerSortIndex={currentSpeakerSortIndex}
              playing={playing}
              subtitle={subtitle}
              thumbnail={thumbnail}
              title={title}
            />
            <AudioSkin className="transcript-audio-skin w-full shrink-0">
              <Audio aria-label={title} preload="metadata">
                {mediaSource}
                {captions}
              </Audio>
            </AudioSkin>
          </div>
          <AudioClockBridge onSeekReady={onSeekReady} onTime={onTime} />
          <AudioErrorBridge onError={setPlaybackError} />
          <AudioPlayingBridge onPlaying={handlePlaying} />
          {onEnded ? <MediaEndedBridge onEnded={onEnded} /> : null}
          {onControlsReady ? <AudioControlsBridge onControlsReady={onControlsReady} /> : null}
          {onPlaybackRate ? (
            <MediaPlaybackRateBridge onPlaybackRate={onPlaybackRate} playbackRate={playbackRate} />
          ) : null}
          {onVolume ? <MediaVolumeBridge onVolume={onVolume} volumeState={volumeState} /> : null}
        </AudioPlayer>
        {showFailure ? <div className="absolute inset-0 z-20">{failedNotice}</div> : null}
      </TranscriptPlayerFrame>
    )
  }

  return (
    <TranscriptPlayerFrame aspectRatio={videoAspect} chrome={chrome} relative>
      <VideoPlayer key={`${src}:${playbackAttempt}`}>
        <VideoSkin className="h-full min-h-0 w-full">
          <Video aria-label={title} playsInline preload="metadata">
            {mediaSource}
            {captions}
          </Video>
        </VideoSkin>
        <VideoAspectBridge onAspectRatio={handleAspectRatio} />
        <VideoClockBridge onSeekReady={onSeekReady} onTime={onTime} />
        <VideoErrorBridge onError={setPlaybackError} />
        <VideoPlayingBridge onPlaying={handlePlaying} />
        {onEnded ? <MediaEndedBridge onEnded={onEnded} /> : null}
        {onControlsReady ? <VideoControlsBridge onControlsReady={onControlsReady} /> : null}
        {onPlaybackRate ? (
          <MediaPlaybackRateBridge onPlaybackRate={onPlaybackRate} playbackRate={playbackRate} />
        ) : null}
        {onVolume ? <MediaVolumeBridge onVolume={onVolume} volumeState={volumeState} /> : null}
      </VideoPlayer>
      {showFailure ? <div className="absolute inset-0 z-20">{failedNotice}</div> : null}
    </TranscriptPlayerFrame>
  )
}
