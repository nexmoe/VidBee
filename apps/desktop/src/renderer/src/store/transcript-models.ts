import { atom, useAtom } from 'jotai'
import { useEffect } from 'react'
import { ipcEvents, ipcServices } from '../lib/ipc'
import { logger } from '../lib/logger'

export interface TranscriptModelPrepStatus {
  downloading: boolean
  percent: number
  ready: boolean
}

export const initialTranscriptModelPrep: TranscriptModelPrepStatus = {
  downloading: false,
  ready: true,
  percent: 100
}

export const transcriptModelPrepAtom = atom<TranscriptModelPrepStatus>(initialTranscriptModelPrep)

/**
 * Read a model-prep payload from IPC without trusting extra fields.
 *
 * @param raw Unknown IPC argument.
 */
const parsePrepStatus = (raw: unknown): TranscriptModelPrepStatus | null => {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const value = raw as { downloading?: unknown; percent?: unknown; ready?: unknown }
  if (typeof value.ready !== 'boolean') {
    return null
  }
  const percent =
    typeof value.percent === 'number' && Number.isFinite(value.percent) ? value.percent : 0
  return {
    downloading: value.downloading === true,
    ready: value.ready,
    percent: Math.min(100, Math.max(0, Math.round(percent)))
  }
}

/**
 * Subscribe to boot-set model download progress for the in-app banner.
 */
export function useTranscriptModelPrep(): TranscriptModelPrepStatus {
  const [status, setStatus] = useAtom(transcriptModelPrepAtom)

  useEffect(() => {
    let disposed = false
    let receivedLiveStatus = false

    /**
     * Store a trusted main-process model prep event.
     */
    const handleStatus = (rawStatus: unknown): void => {
      const next = parsePrepStatus(rawStatus)
      if (!next) {
        return
      }
      receivedLiveStatus = true
      setStatus(next)
    }
    const listener = ipcEvents.on('transcript:models', handleStatus)
    void ipcServices.transcript
      .getModelPrepStatus()
      .then((snapshot) => {
        if (!(disposed || receivedLiveStatus)) {
          const next = parsePrepStatus(snapshot)
          if (next) {
            setStatus(next)
          }
        }
      })
      .catch((error) => logger.error('Failed to load transcript model prep status:', error))

    return () => {
      disposed = true
      ipcEvents.removeListener('transcript:models', listener)
    }
  }, [setStatus])

  return status
}
