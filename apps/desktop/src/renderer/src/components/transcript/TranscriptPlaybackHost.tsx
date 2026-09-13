import { TranscriptVideoJsPlayer } from '@renderer/components/transcript/TranscriptVideoJsPlayer'
import './transcript-player.css'
import { useCachedThumbnail } from '@renderer/hooks/use-cached-thumbnail'
import { useTranscriptMediaPlayer } from '@renderer/hooks/use-transcript-media-player'
import { useTranscriptPlaybackPosition } from '@renderer/hooks/use-transcript-playback-position'
import { toLocalFileSrc } from '@renderer/lib/local-file-src'
import {
  attachPlaybackPlayer,
  setPlaybackParkingEl,
  setPlaybackPlayerWrapEl
} from '@renderer/lib/transcript-playback'
import { planResumeSeek } from '@renderer/lib/transcript-playback-position'
import {
  buildTranscriptPlaybackInput,
  findDownloadRecord,
  resolveRestoredPlaybackInput
} from '@renderer/lib/transcript-playback-source'
import { buildVttText } from '@renderer/lib/transcript-vtt'
import { downloadRecordsAtom } from '@renderer/store/downloads'
import {
  closePlaybackSessionAtom,
  consumePlaybackPlayWhenReadyAtom,
  markPlaybackStartedAtom,
  playbackAspectRatioAtom,
  playbackClockAtom,
  playbackControlsAtom,
  playbackPresentationAtom,
  playbackRateAtom,
  playbackSessionAtom,
  playbackSlotsAtom,
  playbackVolumeAtom,
  restorePlaybackSessionAtom,
  type TranscriptPlaybackClock,
  type TranscriptPlaybackVolume,
  type TranscriptPlayerControls,
  takePlaybackSessionAtom
} from '@renderer/store/transcript-playback'
import {
  finishPlaybackPlaylistItemAtom,
  playbackPlaylistAtom,
  updatePlaylistPlaybackProgressAtom
} from '@renderer/store/transcript-playlist'
import { type TranscriptSegmentView, transcriptMapAtom } from '@renderer/store/transcripts'
import { useAtomValue, useSetAtom } from 'jotai'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const EMPTY_SEGMENTS: TranscriptSegmentView[] = []

/**
 * Keep a single Video.js instance alive across routes and rehome it into page or bar slots.
 */
export function TranscriptPlaybackHost(): ReactNode {
  const session = useAtomValue(playbackSessionAtom)
  const presentation = useAtomValue(playbackPresentationAtom)
  const slots = useAtomValue(playbackSlotsAtom)
  const records = useAtomValue(downloadRecordsAtom)
  const playlistIds = useAtomValue(playbackPlaylistAtom)
  const transcriptMap = useAtomValue(transcriptMapAtom)
  const volumeState = useAtomValue(playbackVolumeAtom)
  const playbackRate = useAtomValue(playbackRateAtom)
  const setClock = useSetAtom(playbackClockAtom)
  const setAspectRatio = useSetAtom(playbackAspectRatioAtom)
  const setVolumeState = useSetAtom(playbackVolumeAtom)
  const setPlaybackRate = useSetAtom(playbackRateAtom)
  const closeSession = useSetAtom(closePlaybackSessionAtom)
  const finishPlaylistItem = useSetAtom(finishPlaybackPlaylistItemAtom)
  const takePlaybackSession = useSetAtom(takePlaybackSessionAtom)
  const restorePlaybackSession = useSetAtom(restorePlaybackSessionAtom)
  const updatePlaylistProgress = useSetAtom(updatePlaylistPlaybackProgressAtom)
  const setControls = useSetAtom(playbackControlsAtom)
  const markStarted = useSetAtom(markPlaybackStartedAtom)
  const consumePlayWhenReady = useSetAtom(consumePlaybackPlayWhenReadyAtom)
  const controls = useAtomValue(playbackControlsAtom)
  const completedDownloadIdRef = useRef<string | null>(null)
  const controlsDownloadIdRef = useRef<string | null>(null)
  const pendingSeekRef = useRef<number | null>(null)
  const seekToRef = useRef<number | null>(null)
  seekToRef.current = session?.seekTo ?? null
  const { t } = useTranslation()
  const parkingRef = useRef<HTMLDivElement>(null)
  const playerWrapRef = useRef<HTMLDivElement>(null)
  const seekRef = useRef<(seconds: number) => void>(() => undefined)
  const transportRef = useRef<Omit<TranscriptPlayerControls, 'seek'>>({
    pause: () => undefined,
    play: () => undefined,
    setPlaybackRate: () => undefined,
    setVolume: () => undefined,
    toggle: () => undefined,
    toggleMute: () => undefined
  })
  const resumeStateRef = useRef({ attempts: 0, done: false })
  const clockRef = useRef<TranscriptPlaybackClock>({
    currentTime: 0,
    duration: 0,
    playing: false
  })

  const downloadId = session?.downloadId ?? ''
  const filePath = session?.filePath ?? null
  const nextDownloadId = playlistIds.find((id) => id !== downloadId) ?? null
  const nextDownload = useMemo(
    () => (nextDownloadId ? findDownloadRecord(records, nextDownloadId) : null),
    [nextDownloadId, records]
  )
  const nextCachedThumbnail = useCachedThumbnail(nextDownload?.thumbnail)
  const nextPlaybackInput = useMemo(
    () =>
      nextDownloadId
        ? buildTranscriptPlaybackInput({
            cachedThumbnail: nextCachedThumbnail,
            download: nextDownload,
            downloadId: nextDownloadId,
            fallbackTitle: t('transcript.title'),
            snapshot: transcriptMap[nextDownloadId] ?? null
          })
        : null,
    [nextCachedThumbnail, nextDownload, nextDownloadId, t, transcriptMap]
  )
  const restoredPlaybackInput = useMemo(
    () =>
      resolveRestoredPlaybackInput({
        downloadIds: playlistIds,
        fallbackTitle: t('transcript.title'),
        records,
        snapshots: transcriptMap
      }),
    [playlistIds, records, t, transcriptMap]
  )
  const player = useTranscriptMediaPlayer({ filePath })
  const { error: playerError, playablePath, retry: retryPrepare } = player
  const { getStartAt, persistTime } = useTranscriptPlaybackPosition(downloadId, playablePath)
  const mediaSrc = playablePath ? toLocalFileSrc(playablePath) : null
  const segments = transcriptMap[downloadId]?.record?.segments ?? EMPTY_SEGMENTS
  const vttText = useMemo(() => buildVttText(segments), [segments])
  const captionsSrc = useMemo(() => {
    if (!vttText) {
      return null
    }
    return URL.createObjectURL(new Blob([vttText], { type: 'text/vtt' }))
  }, [vttText])

  useEffect(() => {
    return () => {
      if (captionsSrc) {
        URL.revokeObjectURL(captionsSrc)
      }
    }
  }, [captionsSrc])

  const publishControls = useCallback(() => {
    setControls({
      pause: () => transportRef.current.pause(),
      play: () => transportRef.current.play(),
      seek: (seconds: number) => seekRef.current(seconds),
      setPlaybackRate: (rate: number) => transportRef.current.setPlaybackRate(rate),
      setVolume: (volume: number) => transportRef.current.setVolume(volume),
      toggle: () => transportRef.current.toggle(),
      toggleMute: () => transportRef.current.toggleMute()
    })
  }, [setControls])

  const handleSeekReady = useCallback(
    (nextSeek: (seconds: number) => void) => {
      seekRef.current = nextSeek
      publishControls()
    },
    [publishControls]
  )

  const handleControlsReady = useCallback(
    (next: Omit<TranscriptPlayerControls, 'seek'>) => {
      transportRef.current = next
      controlsDownloadIdRef.current = downloadId
      publishControls()
    },
    [downloadId, publishControls]
  )

  const handleVolume = useCallback(
    (nextVolumeState: TranscriptPlaybackVolume) => {
      setVolumeState(nextVolumeState)
    },
    [setVolumeState]
  )

  /**
   * Keep the bar and in-page chrome on the same playback rate.
   */
  const handlePlaybackRate = useCallback(
    (rate: number) => {
      setPlaybackRate(rate)
    },
    [setPlaybackRate]
  )

  /**
   * Keep the now-playing cover matched to the source width÷height.
   */
  const handleAspectRatio = useCallback(
    (ratio: number) => {
      setAspectRatio(ratio)
    },
    [setAspectRatio]
  )

  const tryRestore = useCallback(
    (nextTime: number, nextDuration: number): void => {
      if (resumeStateRef.current.done) {
        return
      }
      const forcedStartAt = pendingSeekRef.current
      const startAt = forcedStartAt ?? getStartAt()
      const plan = planResumeSeek(startAt, nextTime, nextDuration)
      if (plan === 'wait') {
        return
      }
      if (plan === 'skip') {
        resumeStateRef.current.done = true
        return
      }
      if (plan === 'done') {
        resumeStateRef.current.done = true
        return
      }
      resumeStateRef.current.attempts += 1
      if (resumeStateRef.current.attempts > 40) {
        resumeStateRef.current.done = true
        return
      }
      seekRef.current(startAt)
    },
    [getStartAt]
  )

  const handleTime = useCallback(
    (nextTime: number, nextDuration: number) => {
      clockRef.current = {
        ...clockRef.current,
        currentTime: nextTime,
        duration: nextDuration
      }
      setClock(clockRef.current)
      updatePlaylistProgress({ currentTime: nextTime, downloadId, duration: nextDuration })
      persistTime(nextTime, nextDuration)
      tryRestore(nextTime, nextDuration)
    },
    [downloadId, persistTime, setClock, tryRestore, updatePlaylistProgress]
  )

  const handlePlaying = useCallback(
    (playing: boolean) => {
      clockRef.current = { ...clockRef.current, playing }
      setClock(clockRef.current)
      if (playing) {
        markStarted()
        consumePlayWhenReady()
      }
    },
    [consumePlayWhenReady, markStarted, setClock]
  )

  /**
   * Remove a completed item and immediately start the next queued item.
   */
  const handleEnded = useCallback((): void => {
    if (!(downloadId && completedDownloadIdRef.current !== downloadId)) {
      return
    }
    completedDownloadIdRef.current = downloadId
    const nextId = finishPlaylistItem(downloadId)
    if (nextPlaybackInput?.downloadId === nextId && nextPlaybackInput.filePath) {
      takePlaybackSession(nextPlaybackInput)
      return
    }
    closeSession()
  }, [closeSession, downloadId, finishPlaylistItem, nextPlaybackInput, takePlaybackSession])

  useEffect(() => {
    if (session?.started || !restoredPlaybackInput) {
      return
    }
    restorePlaybackSession(restoredPlaybackInput)
  }, [restorePlaybackSession, restoredPlaybackInput, session?.started])

  useEffect(() => {
    completedDownloadIdRef.current = null
    controlsDownloadIdRef.current = null
    clockRef.current = { currentTime: 0, duration: 0, playing: false }
    resumeStateRef.current = { attempts: 0, done: false }
    pendingSeekRef.current = seekToRef.current
    seekRef.current = () => undefined
    transportRef.current = {
      pause: () => undefined,
      play: () => undefined,
      setPlaybackRate: () => undefined,
      setVolume: () => undefined,
      toggle: () => undefined,
      toggleMute: () => undefined
    }
    setControls(null)
    setClock({ currentTime: 0, duration: 0, playing: false })
    setAspectRatio(null)
    if (!(downloadId && filePath)) {
      return
    }
  }, [downloadId, filePath, setAspectRatio, setClock, setControls])

  useEffect(() => {
    if (
      !(
        session?.playWhenReady &&
        mediaSrc &&
        controls &&
        controlsDownloadIdRef.current === downloadId
      )
    ) {
      return
    }
    if (session.seekTo != null) {
      controls.seek(session.seekTo)
    }
    controls.play()
  }, [controls, downloadId, mediaSrc, session?.playWhenReady, session?.seekTo])

  useEffect(() => {
    const id = window.setInterval(() => {
      tryRestore(clockRef.current.currentTime, clockRef.current.duration)
    }, 250)
    return () => {
      window.clearInterval(id)
    }
  }, [tryRestore])

  const chrome = slots.page ? 'full' : 'mini'
  const liveVideoTarget = session && !session.isAudio ? slots.bar : null
  useLayoutEffect(() => {
    setPlaybackParkingEl(parkingRef.current)
    setPlaybackPlayerWrapEl(playerWrapRef.current)
    return () => {
      setPlaybackPlayerWrapEl(null)
      setPlaybackParkingEl(null)
    }
  }, [])

  useLayoutEffect(() => {
    attachPlaybackPlayer(slots.page ?? liveVideoTarget)
  }, [liveVideoTarget, slots.page])

  return (
    <div aria-hidden="true" className="transcript-playback-parking" ref={parkingRef}>
      <div className={slots.page ? 'contents' : 'h-full min-h-0 w-full'} ref={playerWrapRef}>
        {session ? (
          <TranscriptVideoJsPlayer
            captionsSrc={captionsSrc}
            chrome={chrome}
            currentSpeakerName={presentation.currentSpeakerName}
            currentSpeakerSortIndex={presentation.currentSpeakerSortIndex}
            isAudio={session.isAudio}
            onAspectRatio={handleAspectRatio}
            onControlsReady={handleControlsReady}
            onEnded={handleEnded}
            onPlaybackRate={handlePlaybackRate}
            onPlaying={handlePlaying}
            onRetryPrepare={retryPrepare}
            onSeekReady={handleSeekReady}
            onTime={handleTime}
            onVolume={handleVolume}
            playbackRate={playbackRate}
            prepareError={playerError}
            preparing={Boolean(filePath) && !playablePath && !playerError}
            src={mediaSrc}
            subtitle={session.subtitle}
            thumbnail={session.thumbnail}
            title={session.title}
            volumeState={volumeState}
          />
        ) : null}
      </div>
    </div>
  )
}
