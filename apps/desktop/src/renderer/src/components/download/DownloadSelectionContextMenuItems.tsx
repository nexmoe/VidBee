import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator
} from '@renderer/components/ui/context-menu'
import {
  LOCAL_DOWNLOAD_PLATFORM_KEY,
  resolveDownloadPlatform
} from '@vidbee/ui/lib/download-platform'
import { useAtomValue, useSetAtom } from 'jotai'
import { Copy, ListPlus, RotateCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcServices } from '../../lib/ipc'
import { logger } from '../../lib/logger'
import { addDownloadAtom, type DownloadRecord } from '../../store/downloads'
import { transcriptMapAtom } from '../../store/transcripts'
import { canRetryDownload } from './download-item-utils'

interface DownloadSelectionContextMenuItemsProps {
  records: DownloadRecord[]
  onAddToPlaylist: () => void
  onDelete: () => void
}

/** Apply history actions to the full selection, including unmounted virtual rows. */
export function DownloadSelectionContextMenuItems({
  records,
  onAddToPlaylist,
  onDelete
}: DownloadSelectionContextMenuItemsProps) {
  const { t } = useTranslation()
  const addDownload = useSetAtom(addDownloadAtom)
  const transcriptMap = useAtomValue(transcriptMapAtom)
  const remoteRecords = records.filter(
    (record) =>
      record.url && resolveDownloadPlatform(record.url).key !== LOCAL_DOWNLOAD_PLATFORM_KEY
  )
  const links = Array.from(new Set(remoteRecords.map((record) => record.url)))
  const retryableDownloads = remoteRecords.filter((record) => canRetryDownload(record.status))
  const retryableTranscripts = records.filter(
    (record) => transcriptMap[record.id]?.listState === 'failed'
  )

  /** Copy selected source URLs in list order with one URL per line. */
  const handleCopyLinks = async (): Promise<void> => {
    if (!(links.length > 0 && navigator.clipboard?.writeText)) {
      toast.error(t('notifications.copyFailed'))
      return
    }
    try {
      await navigator.clipboard.writeText(links.join('\n'))
      toast.success(t('notifications.urlCopied'))
    } catch (error) {
      logger.error('Failed to copy selected links:', error)
      toast.error(t('notifications.copyFailed'))
    }
  }

  /** Retry eligible items serially and keep processing after an individual failure. */
  const handleRetry = async (kind: 'download' | 'transcript'): Promise<void> => {
    const targets = kind === 'download' ? retryableDownloads : retryableTranscripts
    let failed = false
    let alreadyQueued = false
    for (const record of targets) {
      try {
        if (kind === 'transcript') {
          await ipcServices.transcript.retry(record.id)
          continue
        }
        const retried = await ipcServices.download.retryDownload(record.id)
        if (!retried) {
          alreadyQueued = true
          continue
        }
        addDownload({
          ...record,
          status: 'pending',
          progress: { percent: 0 },
          error: undefined
        })
      } catch (error) {
        failed = true
        logger.error('Failed to retry selected item:', { downloadId: record.id, kind, error })
      }
    }
    if (alreadyQueued) {
      toast.info(t('notifications.downloadAlreadyQueued'))
    }
    if (failed) {
      toast.error(
        t(kind === 'download' ? 'notifications.downloadFailed' : 'transcript.retryFailed')
      )
    }
  }

  return (
    <>
      <ContextMenuLabel>{t('history.selectedCount', { count: records.length })}</ContextMenuLabel>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onAddToPlaylist}>
        <ListPlus className="h-4 w-4" />
        {t('transcript.player.playlist.add')}
      </ContextMenuItem>
      <ContextMenuItem disabled={links.length === 0} onClick={() => void handleCopyLinks()}>
        <Copy className="h-4 w-4" />
        {t('history.copyUrl')}
      </ContextMenuItem>
      {retryableDownloads.length > 0 || retryableTranscripts.length > 0 ? (
        <ContextMenuSeparator />
      ) : null}
      {retryableDownloads.length > 0 ? (
        <ContextMenuItem onClick={() => void handleRetry('download')}>
          <RotateCw className="h-4 w-4" />
          {t('download.retry')}
        </ContextMenuItem>
      ) : null}
      {retryableTranscripts.length > 0 ? (
        <ContextMenuItem onClick={() => void handleRetry('transcript')}>
          <RotateCw className="h-4 w-4" />
          {t('transcript.retry')}
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onDelete} variant="destructive">
        <Trash2 className="h-4 w-4" />
        {t('history.deleteSelected')}
      </ContextMenuItem>
    </>
  )
}
