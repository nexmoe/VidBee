import { TranscriptPlaybackBarView } from '@renderer/components/transcript/TranscriptPlaybackBarView'
import { TranscriptPlaylistPopover } from '@renderer/components/transcript/TranscriptPlaylistPopover'
import { prefersReducedMotion } from '@renderer/lib/transcript-follow'
import { segmentAtTime } from '@renderer/lib/transcript-index'
import {
  clampPlaybackRate,
  PLAYBACK_BAR_FULL_VAR,
  PLAYBACK_BAR_HEIGHT_PX,
  PLAYBACK_BAR_HOVER_SLOP_PX,
  PLAYBACK_BAR_HOVER_SLOP_VAR,
  PLAYBACK_BAR_PEEK_PX,
  PLAYBACK_BAR_PEEK_VAR,
  PLAYBACK_BAR_TOGGLE_MS,
  shouldCollapsePlaybackBar,
  shouldShowPlaybackBar
} from '@renderer/lib/transcript-playback'
import {
  closePlaybackSessionAtom,
  playbackAspectRatioAtom,
  playbackClockAtom,
  playbackControlsAtom,
  playbackRateAtom,
  playbackSessionAtom,
  playbackVolumeAtom
} from '@renderer/store/transcript-playback'
import { playbackPlaylistAtom } from '@renderer/store/transcript-playlist'
import { transcriptMapAtom } from '@renderer/store/transcripts'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useAtomValue, useSetAtom } from 'jotai'
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react'

/**
 * Run `fn` after the current View Transition, so CSS transforms are not
 * hidden under the snapshot overlay.
 */
const afterViewTransition = (fn: () => void): (() => void) => {
  const reduce = prefersReducedMotion()
  const transition = document.activeViewTransition
  if (!transition || reduce) {
    fn()
    return () => undefined
  }
  let cancelled = false
  void transition.finished.finally(() => {
    if (!cancelled) {
      fn()
    }
  })
  return () => {
    cancelled = true
  }
}

/**
 * Shell now-playing bar: visible after playback starts.
 *
 * Transcript detail pages collapse it to the seek strip. Hover, focus, or an
 * open popover expands the full chrome with the same slide used to show the bar.
 */
export function TranscriptPlaybackBar(): ReactNode {
  const session = useAtomValue(playbackSessionAtom)
  const clock = useAtomValue(playbackClockAtom)
  const videoRatio = useAtomValue(playbackAspectRatioAtom)
  const volumeState = useAtomValue(playbackVolumeAtom)
  const playbackRate = useAtomValue(playbackRateAtom)
  const setPlaybackRate = useSetAtom(playbackRateAtom)
  const controls = useAtomValue(playbackControlsAtom)
  const playlistIds = useAtomValue(playbackPlaylistAtom)
  const transcriptMap = useAtomValue(transcriptMapAtom)
  const closeSession = useSetAtom(closePlaybackSessionAtom)
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [open, setOpen] = useState(false)
  const [held, setHeld] = useState(false)
  const wantOpen = shouldShowPlaybackBar({
    downloadId: session?.downloadId ?? null,
    pathname,
    playlistCount: playlistIds.length,
    started: Boolean(session?.started)
  })
  const compact = shouldCollapsePlaybackBar(pathname)
  const currentLine = useMemo(() => {
    if (!session) {
      return null
    }
    const segments = transcriptMap[session.downloadId]?.record?.segments ?? []
    return segmentAtTime(segments, Math.round(clock.currentTime * 1000))?.text ?? null
  }, [clock.currentTime, session, transcriptMap])

  useEffect(() => {
    let hideTimer: number | undefined
    const cancelWait = afterViewTransition(() => {
      if (wantOpen) {
        setHeld(true)
        setOpen(true)
        return
      }
      setOpen(false)
      const delay = prefersReducedMotion() ? 0 : PLAYBACK_BAR_TOGGLE_MS
      hideTimer = window.setTimeout(() => setHeld(false), delay)
    })
    return () => {
      cancelWait()
      if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer)
      }
    }
  }, [wantOpen])

  useEffect(() => {
    if (!(session?.started && playlistIds.length === 0)) {
      return
    }
    const delay = prefersReducedMotion() ? 0 : PLAYBACK_BAR_TOGGLE_MS
    const id = window.setTimeout(() => {
      controls?.pause()
      closeSession()
    }, delay)
    return () => window.clearTimeout(id)
  }, [closeSession, controls, playlistIds.length, session?.started])

  if (!(session?.started && (open || held))) {
    return null
  }

  return (
    <div
      className="transcript-playback-bar-slot"
      data-collapsed={compact ? 'true' : 'false'}
      data-open={open ? 'true' : 'false'}
      data-testid="transcript-playback-bar-slot"
      inert={!open}
      style={
        {
          [PLAYBACK_BAR_FULL_VAR]: `${PLAYBACK_BAR_HEIGHT_PX}px`,
          [PLAYBACK_BAR_HOVER_SLOP_VAR]: `${PLAYBACK_BAR_HOVER_SLOP_PX}px`,
          [PLAYBACK_BAR_PEEK_VAR]: `${PLAYBACK_BAR_PEEK_PX}px`
        } as CSSProperties
      }
    >
      <div className="transcript-playback-bar-slot-clip">
        <TranscriptPlaybackBarView
          compact={compact}
          currentLine={currentLine}
          currentTime={clock.currentTime}
          duration={clock.duration}
          isAudio={session.isAudio}
          muted={volumeState.muted}
          onOpen={() => {
            void navigate({
              params: { downloadId: session.downloadId },
              to: '/downloads/$downloadId/transcript'
            })
          }}
          onPlaybackRateChange={(rate) => {
            const next = clampPlaybackRate(rate)
            setPlaybackRate(next)
            controls?.setPlaybackRate(next)
          }}
          onSeek={(seconds) => {
            controls?.seek(seconds)
          }}
          onToggle={() => {
            controls?.toggle()
          }}
          onToggleMute={() => {
            controls?.toggleMute()
          }}
          onVolumeChange={(volume) => {
            controls?.setVolume(volume)
          }}
          playbackRate={playbackRate}
          playing={clock.playing}
          playlistControl={<TranscriptPlaylistPopover />}
          thumbnail={session.thumbnail}
          title={session.title}
          videoRatio={videoRatio}
          volume={volumeState.volume}
        />
      </div>
    </div>
  )
}
