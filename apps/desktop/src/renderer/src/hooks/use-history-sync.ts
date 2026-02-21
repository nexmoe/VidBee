import { useSetAtom } from 'jotai'
import { useEffect } from 'react'
// import type { DownloadHistoryItem } from '../../../shared/types'
import { ipcServices } from '../lib/ipc'
import { addHistoryRecordAtom, clearHistoryRecordsAtom } from '../store/downloads'

export function useHistorySync() {
  const addHistoryItem = useSetAtom(addHistoryRecordAtom)
  const clearHistory = useSetAtom(clearHistoryRecordsAtom)

  useEffect(() => {
    // Load initial history from main process
    const loadHistory = async () => {
      try {
        const historyData = await ipcServices.history.getHistory()
        // Clear existing history and load from main process
        clearHistory()
        historyData.forEach((item) => {
          addHistoryItem(item)
        })
      } catch (error) {
        console.error('Failed to load history:', error)
      }
    }

    loadHistory()

    // Listen for new history items from main process
    // const _handleHistoryAdded = (item: DownloadHistoryItem) => {
    //   addHistoryItem(item)
    // }

    // Note: We would need to add IPC events for real-time updates
    // For now, we'll rely on manual refresh or page navigation
  }, [addHistoryItem, clearHistory])
}
