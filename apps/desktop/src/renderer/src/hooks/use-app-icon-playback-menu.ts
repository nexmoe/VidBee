import { ipcEvents, ipcServices } from '@renderer/lib/ipc'
import { resolvePlaybackPreviousCommand } from '@renderer/lib/transcript-playback'
import {
  buildTranscriptPlaybackInput,
  findDownloadRecord
} from '@renderer/lib/transcript-playback-source'
import { resolvePlayablePlaylistSkip, resolvePlaylistSkip } from '@renderer/lib/transcript-playlist'
import { downloadRecordsAtom } from '@renderer/store/downloads'
import {
  playbackClockAtom,
  playbackControlsAtom,
  playbackSessionAtom,
  takePlaybackSessionAtom
} from '@renderer/store/transcript-playback'
import { playbackPlaylistAtom } from '@renderer/store/transcript-playlist'
import { transcriptMapAtom } from '@renderer/store/transcripts'
import {
  APP_ICON_MENU_COMMAND_CHANNEL,
  type AppIconMenuState,
  buildAppIconMenuState,
  isAppIconMenuCommand,
  sameAppIconMenuState
} from '@shared/app-icon-menu'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Sync Play / Next / Previous on the dock and tray, and run those commands here.
 */
export function useAppIconPlaybackMenu(): void {
  const { t } = useTranslation()
  const session = useAtomValue(playbackSessionAtom)
  const clock = useAtomValue(playbackClockAtom)
  const controls = useAtomValue(playbackControlsAtom)
  const playlistIds = useAtomValue(playbackPlaylistAtom)
  const records = useAtomValue(downloadRecordsAtom)
  const transcriptMap = useAtomValue(transcriptMapAtom)
  const takeSession = useSetAtom(takePlaybackSessionAtom)
  const clockRef = useRef(clock)
  const controlsRef = useRef(controls)
  const playlistIdsRef = useRef(playlistIds)
  const recordsRef = useRef(records)
  const sessionRef = useRef(session)
  const transcriptMapRef = useRef(transcriptMap)
  const takeSessionRef = useRef(takeSession)
  const fallbackTitleRef = useRef(t('transcript.title'))
  const menuStateRef = useRef<AppIconMenuState | null>(null)
  clockRef.current = clock
  controlsRef.current = controls
  playlistIdsRef.current = playlistIds
  recordsRef.current = records
  sessionRef.current = session
  transcriptMapRef.current = transcriptMap
  takeSessionRef.current = takeSession
  fallbackTitleRef.current = t('transcript.title')

  useEffect(() => {
    const nextState = buildAppIconMenuState({
      playlistCount: playlistIds.length,
      playing: clock.playing,
      sessionId: session?.downloadId ?? null
    })
    if (menuStateRef.current && sameAppIconMenuState(menuStateRef.current, nextState)) {
      return
    }
    menuStateRef.current = nextState
    void ipcServices.player.syncIconMenu(nextState)
  }, [clock.playing, playlistIds.length, session?.downloadId])

  useEffect(() => {
    /**
     * Start a playlist item when its local media is still available.
     */
    const playPlaylistItem = (downloadId: string): boolean => {
      const playbackInput = buildTranscriptPlaybackInput({
        download: findDownloadRecord(recordsRef.current, downloadId),
        downloadId,
        fallbackTitle: fallbackTitleRef.current,
        snapshot: transcriptMapRef.current[downloadId] ?? null
      })
      if (!playbackInput.filePath) {
        return false
      }
      takeSessionRef.current(playbackInput)
      return true
    }

    /**
     * Walk to the next playable neighbor in the requested direction.
     */
    const playSkip = (direction: 'next' | 'previous'): void => {
      const nextId = resolvePlayablePlaylistSkip(
        playlistIdsRef.current,
        sessionRef.current?.downloadId ?? null,
        direction,
        (downloadId) => {
          const playbackInput = buildTranscriptPlaybackInput({
            download: findDownloadRecord(recordsRef.current, downloadId),
            downloadId,
            fallbackTitle: fallbackTitleRef.current,
            snapshot: transcriptMapRef.current[downloadId] ?? null
          })
          return Boolean(playbackInput.filePath)
        }
      )
      if (nextId) {
        playPlaylistItem(nextId)
      }
    }

    /**
     * Run a dock or tray playback command against the current player session.
     */
    const onCommand = (...args: unknown[]): void => {
      const command = args[0]
      if (!isAppIconMenuCommand(command)) {
        return
      }
      if (command === 'toggle') {
        if (controlsRef.current) {
          controlsRef.current.toggle()
          return
        }
        const current = sessionRef.current
        if (current?.filePath) {
          takeSessionRef.current(current)
          return
        }
        const firstId = playlistIdsRef.current[0]
        if (firstId) {
          playPlaylistItem(firstId)
        }
        return
      }
      if (command === 'next') {
        playSkip('next')
        return
      }
      const previousId = resolvePlaylistSkip(
        playlistIdsRef.current,
        sessionRef.current?.downloadId ?? null,
        'previous'
      )
      const action = resolvePlaybackPreviousCommand({
        currentTime: clockRef.current.currentTime,
        previousId
      })
      if (action === 'seek-start') {
        controlsRef.current?.seek(0)
        return
      }
      playSkip('previous')
    }

    const unsubscribe = ipcEvents.on(APP_ICON_MENU_COMMAND_CHANNEL, onCommand)
    return () => {
      ipcEvents.removeListener(APP_ICON_MENU_COMMAND_CHANNEL, unsubscribe)
    }
  }, [])
}
