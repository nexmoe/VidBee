import { useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { ipcServices } from '../lib/ipc'
import { logger } from '../lib/logger'
import { replaceHistoryRecordsAtom } from '../store/downloads'

/**
 * Load the main-process history once. Later terminal rows arrive through download events.
 */
export function useHistorySync() {
  const replaceHistory = useSetAtom(replaceHistoryRecordsAtom)

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const historyData = await ipcServices.history.getHistory()
        replaceHistory(historyData)
      } catch (error) {
        logger.error('Failed to load history:', error)
      }
    }

    void loadHistory()
  }, [replaceHistory])
}
