import { ipcEvents, ipcServices } from '@renderer/lib/ipc'
import { alignBilingualCaptions, type BilingualCue } from '@renderer/lib/transcript-bilingual'
import { useEffect, useMemo, useState } from 'react'

const EMPTY_CAPTIONS: Record<string, string> = {}

/** Read an existing secondary track without changing the selected transcript or starting work. */
export function useBilingualCaptions(
  downloadId: string | undefined,
  primary: readonly (BilingualCue & { id: string })[],
  sourceKey: string | undefined,
  enabled: boolean
) {
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([downloadId, sourceKey, attempt])
  const [state, setState] = useState<{
    key: string
    cues: BilingualCue[]
    loading: boolean
    failed: boolean
  }>({ key: '', cues: [], loading: false, failed: false })

  useEffect(() => {
    if (!(enabled && downloadId && sourceKey)) {
      return
    }
    let cancelled = false
    const off = ipcEvents.on('transcript:updated', (...args: unknown[]) => {
      const snapshot = args[0] as { downloadTaskId?: string }
      if (snapshot?.downloadTaskId === downloadId) {
        setAttempt((previous) => previous + 1)
      }
    })
    setState({ key, cues: [], loading: true, failed: false })
    void ipcServices.transcript
      .getSourceCues({ downloadId, key: sourceKey })
      .then((cues) => {
        if (!cancelled) {
          setState({ key, cues, loading: false, failed: cues.length === 0 })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ key, cues: [], loading: false, failed: true })
        }
      })
    return () => {
      cancelled = true
      ipcEvents.removeListener('transcript:updated', off)
    }
  }, [downloadId, enabled, key, sourceKey])

  const current = enabled && state.key === key
  const captions = useMemo(
    () => (current ? alignBilingualCaptions(primary, state.cues) : EMPTY_CAPTIONS),
    [current, primary, state.cues]
  )
  /** Retry reading a missing or unreadable subtitle track. */
  const retry = (): void => setAttempt((previous) => previous + 1)
  return { captions, loading: current && state.loading, failed: current && state.failed, retry }
}
