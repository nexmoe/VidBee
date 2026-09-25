import type { DownloadItem } from '@shared/types'
import {
  getCookieSetupFailureKind,
  hasConfiguredCookieSettings
} from '@vidbee/downloader-core/cookie-setup'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { buildFilePathCandidates } from '../../../shared/utils/download-file'
import { getDownloadErrorGuidance } from '../lib/download-error-guidance'
import { ipcEvents, ipcServices } from '../lib/ipc'
import { logger } from '../lib/logger'
import { cookieSetupAutoPromptedAtom, cookieSetupRequestAtom } from '../store/cookie-setup'
import {
  addDownloadAtom,
  addHistoryRecordAtom,
  downloadRecordsAtom,
  removeDownloadAtom,
  removeHistoryRecordAtom,
  updateDownloadAtom
} from '../store/downloads'
import { enableDownloadNotificationsAtom, settingsAtom } from '../store/settings'

const isFinalStatus = (status?: string): boolean =>
  status === 'completed' || status === 'error' || status === 'cancelled'

export function useDownloadEvents() {
  const updateDownload = useSetAtom(updateDownloadAtom)
  const addDownload = useSetAtom(addDownloadAtom)
  const addHistoryRecord = useSetAtom(addHistoryRecordAtom)
  const removeDownload = useSetAtom(removeDownloadAtom)
  const removeHistoryRecord = useSetAtom(removeHistoryRecordAtom)
  const { t } = useTranslation()
  const store = useStore()
  const enableDownloadNotifications = useAtomValue(enableDownloadNotificationsAtom)

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
        return historyItem
      } catch (error) {
        logger.error('Failed to sync history item:', error)
        return undefined
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
        logger.error('Failed to load active downloads:', error)
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

    const handleLog = (rawData: unknown) => {
      const data = rawData as { id?: string; log?: string }
      const id = typeof data?.id === 'string' ? data.id : ''
      if (!id) {
        return
      }
      const logText = typeof data?.log === 'string' ? data.log : ''
      updateDownload({ id, changes: { ytDlpLog: logText } })
    }

    const handleCompleted = (rawId: unknown) => {
      const id = typeof rawId === 'string' ? rawId : ''
      if (!id) {
        return
      }
      updateDownload({ id, changes: { status: 'completed', completedAt: Date.now() } })
      toast.success(t('notifications.downloadCompleted'))
      void (async () => {
        const historyItem = await syncHistoryItem(id)
        if (!(historyItem?.downloadPath && historyItem.title)) {
          return
        }
        if (historyItem.status !== 'completed' || enableDownloadNotifications === false) {
          return
        }
        const format =
          historyItem.savedFileName?.split('.').pop()?.toLowerCase() ||
          historyItem.selectedFormat?.ext?.toLowerCase() ||
          (historyItem.type === 'audio' ? 'mp3' : 'mp4')
        const filePaths = buildFilePathCandidates(
          historyItem.downloadPath,
          historyItem.title,
          format,
          historyItem.savedFileName
        )
        void ipcServices.fs.showDownloadCompletedNotification(
          historyItem.title,
          t('notifications.downloadCompleted'),
          filePaths,
          historyItem.downloadPath
        )
      })()
    }

    /**
     * Mark a download as failed, and open cookie setup when the error is auth-related.
     *
     * @param rawData Download error event payload.
     */
    const handleError = (rawData: unknown) => {
      const data = rawData as { id?: string; error?: string }
      const id = typeof data?.id === 'string' ? data.id : ''
      if (!id) {
        return
      }
      const errorMessage = typeof data?.error === 'string' ? data.error : ''
      updateDownload({ id, changes: { status: 'error', error: errorMessage } })
      const cookieFailureKind = getCookieSetupFailureKind(errorMessage)
      const guidance = getDownloadErrorGuidance(errorMessage) ?? t('notifications.downloadFailed')
      if (cookieFailureKind) {
        toast.error(guidance, {
          action: {
            label: t('download.cookiesSetupAction'),
            onClick: () => {
              store.set(cookieSetupRequestAtom, {
                downloadId: id,
                failureKind: cookieFailureKind
              })
            }
          }
        })
        const settings = store.get(settingsAtom)
        const alreadyPrompted = store.get(cookieSetupAutoPromptedAtom)
        if (
          !(
            alreadyPrompted ||
            hasConfiguredCookieSettings(settings.browserForCookies, settings.cookiesPath)
          )
        ) {
          store.set(cookieSetupAutoPromptedAtom, true)
          store.set(cookieSetupRequestAtom, {
            downloadId: id,
            failureKind: cookieFailureKind
          })
        }
      } else {
        toast.error(guidance)
      }
      void syncHistoryItem(id)
    }

    const handleCancelled = (rawId: unknown) => {
      const id = typeof rawId === 'string' ? rawId : ''
      if (!id) {
        return
      }
      removeDownload(id)
      removeHistoryRecord(id)
    }

    const handleQueued = (rawItem: unknown) => {
      const item = rawItem as DownloadItem
      if (!item || typeof item.id !== 'string') {
        return
      }
      const records = store.get(downloadRecordsAtom)
      if (records.has(`active:${item.id}`)) {
        return
      }
      addDownload(item)
    }

    const handleUpdated = (rawData: unknown) => {
      const data = rawData as { id?: string; updates?: Partial<DownloadItem> }
      const id = typeof data?.id === 'string' ? data.id : ''
      if (!(id && data?.updates)) {
        return
      }
      updateDownload({ id, changes: data.updates })
      if (isFinalStatus(data.updates.status)) {
        void syncHistoryItem(id)
      }
    }

    const queuedSubscription = ipcEvents.on('download:queued', handleQueued)
    const updatedSubscription = ipcEvents.on('download:updated', handleUpdated)
    const startedSubscription = ipcEvents.on('download:started', handleStarted)
    const progressSubscription = ipcEvents.on('download:progress', handleProgress)
    const logSubscription = ipcEvents.on('download:log', handleLog)
    const completedSubscription = ipcEvents.on('download:completed', handleCompleted)
    const errorSubscription = ipcEvents.on('download:error', handleError)
    const cancelledSubscription = ipcEvents.on('download:cancelled', handleCancelled)
    const removedSubscription = ipcEvents.on('download:removed', handleCancelled)
    return () => {
      ipcEvents.removeListener('download:queued', queuedSubscription)
      ipcEvents.removeListener('download:updated', updatedSubscription)
      ipcEvents.removeListener('download:started', startedSubscription)
      ipcEvents.removeListener('download:progress', progressSubscription)
      ipcEvents.removeListener('download:log', logSubscription)
      ipcEvents.removeListener('download:completed', completedSubscription)
      ipcEvents.removeListener('download:error', errorSubscription)
      ipcEvents.removeListener('download:cancelled', cancelledSubscription)
      ipcEvents.removeListener('download:removed', removedSubscription)
    }
  }, [
    addDownload,
    enableDownloadNotifications,
    removeDownload,
    removeHistoryRecord,
    store,
    syncHistoryItem,
    t,
    updateDownload
  ])
}
