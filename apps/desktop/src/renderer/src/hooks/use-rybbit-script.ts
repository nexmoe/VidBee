import { useEffect, useState } from 'react'

const RYBBIT_READY_POLL_INTERVAL_MS = 250
const RYBBIT_SCRIPT_ID = 'vidbee-rybbit-script'
const RYBBIT_SCRIPT_SITE_ID = '7bc6f6d625a4'
const RYBBIT_SCRIPT_SRC = 'https://rybbit.102417.xyz/api/script.js'

export const useRybbitScript = (enabled: boolean): boolean => {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let readyPollId: number | null = null

    const stopReadyPoll = () => {
      if (readyPollId !== null) {
        window.clearInterval(readyPollId)
        readyPollId = null
      }
    }

    const syncReadyState = () => {
      const nextReadyState = Boolean(window.rybbit)
      setIsReady(nextReadyState)
      if (nextReadyState) {
        stopReadyPoll()
      }
    }

    if (!enabled) {
      document.getElementById(RYBBIT_SCRIPT_ID)?.remove()
      stopReadyPoll()
      setIsReady(false)
      return
    }

    if (!document.getElementById(RYBBIT_SCRIPT_ID)) {
      const scriptElement = document.createElement('script')
      scriptElement.dataset.siteId = RYBBIT_SCRIPT_SITE_ID
      scriptElement.defer = true
      scriptElement.id = RYBBIT_SCRIPT_ID
      scriptElement.src = RYBBIT_SCRIPT_SRC
      document.head.append(scriptElement)
    }

    syncReadyState()
    if (!window.rybbit) {
      readyPollId = window.setInterval(syncReadyState, RYBBIT_READY_POLL_INTERVAL_MS)
    }

    return () => {
      stopReadyPoll()
    }
  }, [enabled])

  return isReady
}
