import { useSetAtom } from 'jotai'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcEvents, ipcServices } from '../lib/ipc'
import {
  addDownloadAtom,
  addHistoryRecordAtom,
  removeDownloadAtom,
  updateDownloadAtom
} from '../store/downloads'

const isFinalStatus = (status?: string): boolean =>
  status === 'completed' || status === 'error' || status === 'cancelled'

export function useDownloadEvents() {
  const updateDownload = useSetAtom(updateDownloadAtom)
  const addDownload = useSetAtom(addDownloadAtom)
  const addHistoryRecord = useSetAtom(addHistoryRecordAtom)
  const removeDownload = useSetAtom(removeDownloadAtom)
  const { t } = useTranslation()

  const syncHistoryItem = useCallback(
    async (id: string) => {
      try {
        const historyItem = await ipcServices.history.getHistoryById(id)
        if (!historyItem) {
          return
        }
        addHistoryRecord(historyItem)
        if (isFinalStatus(historyItem.status)) {
          removeDownload(id)
        }
      } catch (error) {
        console.error('Failed to sync history item:', error)
      }
    },
    [addHistoryRecord, removeDownload]
  )

  useEffect(() => {
    const syncActiveDownloads = async () => {
      try {
        const activeDownloads = await ipcServices.download.getActiveDownloads()
        activeDownloads.forEach((item) => {
          addDownload(item)
        })
      } catch (error) {
        console.error('Failed to load active downloads:', error)
      }
    }

    void syncActiveDownloads()
  }, [addDownload])

  useEffect(() => {
    const handleStarted = (rawId: unknown) => {
      const id = typeof rawId === 'string' ? rawId : ''
      if (!id) {
        return
      }
      updateDownload({
        id,
        changes: {
          status: 'downloading',
          startedAt: Date.now()
        }
      })
    }

    const handleProgress = (rawData: unknown) => {
      const data = rawData as { id?: string; progress?: unknown }
      const id = typeof data?.id === 'string' ? data.id : ''
      if (!id) {
        return
      }
      const progress = (data.progress ?? {}) as {
        percent?: number
        currentSpeed?: string
        eta?: string
        downloaded?: string
        total?: string
      }
      updateDownload({
        id,
        changes: {
          progress: {
            percent: typeof progress.percent === 'number' ? progress.percent : 0,
            currentSpeed: progress.currentSpeed || '',
            eta: progress.eta || '',
            downloaded: progress.downloaded || '',
            total: progress.total || ''
          },
          speed: progress.currentSpeed || ''
        }
      })
    }

    const handleCompleted = (rawId: unknown) => {
      const id = typeof rawId === 'string' ? rawId : ''
      if (!id) {
        return
      }
      updateDownload({ id, changes: { status: 'completed', completedAt: Date.now() } })
      toast.success(t('notifications.downloadCompleted'))
      void syncHistoryItem(id)
    }

    const handleError = (rawData: unknown) => {
      const data = rawData as { id?: string; error?: string }
      const id = typeof data?.id === 'string' ? data.id : ''
      if (!id) {
        return
      }
      const errorMessage = typeof data?.error === 'string' ? data.error : ''
      updateDownload({ id, changes: { status: 'error', error: errorMessage } })
      toast.error(t('notifications.downloadFailed'))
      void syncHistoryItem(id)
    }

    const handleCancelled = (rawId: unknown) => {
      const id = typeof rawId === 'string' ? rawId : ''
      if (!id) {
        return
      }
      updateDownload({ id, changes: { status: 'cancelled', completedAt: Date.now() } })
      void syncHistoryItem(id)
    }

    const startedSubscription = ipcEvents.on('download:started', handleStarted)
    const progressSubscription = ipcEvents.on('download:progress', handleProgress)
    const completedSubscription = ipcEvents.on('download:completed', handleCompleted)
    const errorSubscription = ipcEvents.on('download:error', handleError)
    const cancelledSubscription = ipcEvents.on('download:cancelled', handleCancelled)

    return () => {
      ipcEvents.removeListener('download:started', startedSubscription)
      ipcEvents.removeListener('download:progress', progressSubscription)
      ipcEvents.removeListener('download:completed', completedSubscription)
      ipcEvents.removeListener('download:error', errorSubscription)
      ipcEvents.removeListener('download:cancelled', cancelledSubscription)
    }
  }, [syncHistoryItem, t, updateDownload])
}
