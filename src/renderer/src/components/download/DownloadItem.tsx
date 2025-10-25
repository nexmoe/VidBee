import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { ImageWithPlaceholder } from '@renderer/components/ui/image-with-placeholder'
import { Progress } from '@renderer/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useAtomValue, useSetAtom } from 'jotai'
import { AlertCircle, CheckCircle2, Copy, FolderOpen, Loader2, Play, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useCachedThumbnail } from '../../hooks/use-cached-thumbnail'
import { ipcServices } from '../../lib/ipc'
import {
  type DownloadRecord,
  removeDownloadAtom,
  removeHistoryRecordAtom
} from '../../store/downloads'
import { settingsAtom } from '../../store/settings'

// Helper function to generate file path with proper path separators
const generateFilePath = (downloadPath: string, title: string, format: string): string => {
  const fileName = `${title}.${format}`
  // Use proper path joining for cross-platform compatibility
  // Handle both forward and backward slashes for cross-platform compatibility
  const normalizedDownloadPath = downloadPath.replace(/\\/g, '/')
  return `${normalizedDownloadPath}/${fileName}`
}

interface DownloadItemProps {
  download: DownloadRecord
}

const formatFileSize = (bytes?: number) => {
  if (!bytes) return ''
  const sizes = ['B', 'KB', 'MB', 'GB']
  const order = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1)
  return `${(bytes / 1024 ** order).toFixed(1)} ${sizes[order]}`
}

const formatDuration = (seconds?: number) => {
  if (!seconds) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

const formatDate = (timestamp?: number) => {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleString()
}

export function DownloadItem({ download }: DownloadItemProps) {
  const { t } = useTranslation()
  const settings = useAtomValue(settingsAtom)
  const removeDownload = useSetAtom(removeDownloadAtom)
  const removeHistory = useSetAtom(removeHistoryRecordAtom)
  const isHistory = download.entryType === 'history'
  const timestamp = download.completedAt ?? download.downloadedAt ?? download.createdAt
  const thumbnailSrc = useCachedThumbnail(download.thumbnail)
  const showActionsWithoutHover = isHistory || download.status === 'completed'
  const actionsContainerBaseClass =
    'flex shrink-0 flex-wrap items-center justify-end gap-1 text-muted-foreground opacity-100 transition-opacity'
  const actionsContainerClass = showActionsWithoutHover
    ? actionsContainerBaseClass
    : `${actionsContainerBaseClass} sm:opacity-0 sm:group-hover:opacity-100`

  const handleCancel = async () => {
    if (isHistory) return
    try {
      await ipcServices.download.cancelDownload(download.id)
      removeDownload(download.id)
    } catch (error) {
      console.error('Failed to cancel download:', error)
    }
  }

  const handleOpenFolder = async () => {
    try {
      // Generate file path using downloadPath + title + ext
      const downloadPath = download.downloadPath || settings.downloadPath
      const format = download.format || (download.type === 'audio' ? 'mp3' : 'mp4')
      const filePath = generateFilePath(downloadPath, download.title, format)

      const success = await ipcServices.fs.openFileLocation(filePath)
      if (!success) {
        toast.error(t('notifications.openFolderFailed'))
      }
    } catch (error) {
      console.error('Failed to open file location:', error)
      toast.error(t('notifications.openFolderFailed'))
    }
  }
  // need title, downloadPath, format
  const handleCopyToClipboard = async () => {
    if (!download.title || !download.downloadPath || !download.format) {
      toast.error(t('notifications.copyFailed'))
      return
    }

    try {
      // Generate file path using downloadPath + title + ext
      const downloadPath = download.downloadPath
      const format = download.format
      const filePath = generateFilePath(downloadPath, download.title, format)

      const success = await ipcServices.fs.copyFileToClipboard(filePath)
      if (!success) {
        toast.error(t('notifications.copyFailed'))
        return
      }
      toast.success(t('notifications.videoCopied'))
    } catch (error) {
      console.error('Failed to copy file to clipboard:', error)
      toast.error(t('notifications.copyFailed'))
    }
  }

  // need id
  const handleRemoveHistory = async () => {
    if (!isHistory) return
    try {
      // Generate file path using downloadPath + title + ext
      const downloadPath = download.downloadPath || settings.downloadPath
      const format = download.format || (download.type === 'audio' ? 'mp3' : 'mp4')
      const filePath = generateFilePath(downloadPath, download.title, format)

      // Remove from history first
      await ipcServices.history.removeHistoryItem(download.id)

      // Then try to delete the file
      await ipcServices.fs.deleteFile(filePath)

      removeHistory(download.id)
      toast.success(t('notifications.itemRemoved'))
    } catch (error) {
      console.error('Failed to remove item:', error)
      toast.error(t('notifications.removeFailed'))
    }
  }

  const getStatusIcon = () => {
    switch (download.status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'error':
        return <AlertCircle className="h-4 w-4 text-destructive" />
      case 'downloading':
      case 'processing':
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />
      case 'pending':
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      case 'cancelled':
        return <X className="h-4 w-4 text-muted-foreground" />
      default:
        return null
    }
  }

  const getStatusText = () => {
    switch (download.status) {
      case 'completed':
        return t('download.completed')
      case 'error':
        return t('download.error')
      case 'downloading':
        return t('download.downloading')
      case 'processing':
        return t('download.processing')
      case 'pending':
        return t('download.downloadPending')
      case 'cancelled':
        return t('download.cancelled')
      default:
        return ''
    }
  }

  const statusIcon = getStatusIcon()
  const statusText = getStatusText()

  return (
    <div className="group relative w-full max-w-full overflow-hidden">
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:gap-4">
        {/* Thumbnail */}
        <div className="shrink-0 overflow-hidden rounded-md border border-border/60 bg-background/60 w-32 h-20">
          <ImageWithPlaceholder
            src={thumbnailSrc}
            alt={download.title}
            className="w-full h-full object-cover"
            fallbackIcon={<Play className="h-6 w-6" />}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 max-w-full space-y-3 overflow-hidden">
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
            <div className="flex-1 min-w-0 max-w-full space-y-2 overflow-hidden">
              <div className="w-full min-w-0 overflow-hidden">
                <p className="w-full wrap-break-word text-sm font-medium sm:text-base line-clamp-2">
                  {download.title}
                </p>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="bg-muted/50 capitalize text-[11px] font-medium">
                  {download.type}
                </Badge>
                {(statusIcon || statusText) && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    {statusIcon}
                    <span>{statusText}</span>
                  </div>
                )}
              </div>
              <div className="flex w-full min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {timestamp ? (
                  <span className="truncate max-w-[120px]">{formatDate(timestamp)}</span>
                ) : null}

                <span className="truncate max-w-[120px] text-left">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a
                        href={download.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-primary transition-colors cursor-pointer"
                      >
                        {download.uploader &&
                        download.channel &&
                        download.uploader !== download.channel
                          ? `${download.uploader} • ${download.channel}`
                          : download.uploader
                            ? `${download.uploader}`
                            : download.channel
                              ? `${download.channel}`
                              : ''}
                      </a>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs wrap-break-word">
                      <p>{download.url}</p>
                    </TooltipContent>
                  </Tooltip>
                </span>
                {download.duration ? <span>{formatDuration(download.duration)}</span> : null}
                {download.selectedFormat ? (
                  <>
                    {download.selectedFormat.height ? (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">
                        {download.selectedFormat.height}p
                        {download.selectedFormat.fps === 60 ? '60' : ''}
                      </Badge>
                    ) : null}
                    {download.selectedFormat.ext ? (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
                        {download.selectedFormat.ext.toUpperCase()}
                      </Badge>
                    ) : null}
                    {download.selectedFormat.filesize || download.selectedFormat.filesize_approx ? (
                      <span className="text-[10px] opacity-75">
                        {formatFileSize(
                          download.selectedFormat.filesize ||
                            download.selectedFormat.filesize_approx
                        )}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <>
                    {download.quality ? (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">
                        {download.quality}
                      </Badge>
                    ) : null}
                    {download.format ? (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
                        {download.format.toUpperCase()}
                      </Badge>
                    ) : null}
                    {download.codec ? (
                      <span className="text-[10px] opacity-75">{download.codec}</span>
                    ) : null}
                  </>
                )}
              </div>
            </div>
            <div className={actionsContainerClass}>
              {isHistory ? (
                <>
                  {download.status === 'completed' && (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={handleCopyToClipboard}
                            disabled={!download.title || !download.downloadPath || !download.format}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t('history.copyToClipboard')}</p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={handleOpenFolder}
                          >
                            <FolderOpen className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t('history.openFolder')}</p>
                        </TooltipContent>
                      </Tooltip>
                    </>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={handleRemoveHistory}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t('history.removeItem')}</p>
                    </TooltipContent>
                  </Tooltip>
                </>
              ) : (
                <>
                  {download.status === 'completed' && (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={handleCopyToClipboard}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t('history.copyToClipboard')}</p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={handleOpenFolder}
                          >
                            <FolderOpen className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t('history.openFolder')}</p>
                        </TooltipContent>
                      </Tooltip>
                    </>
                  )}
                  {(download.status === 'downloading' ||
                    download.status === 'pending' ||
                    download.status === 'processing') && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={handleCancel}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Progress */}
          {download.progress && download.status !== 'completed' && download.status !== 'error' && (
            <div className="space-y-2 bg-background/60 w-full overflow-hidden">
              <Progress value={download.progress.percent} className="h-1.5 w-full" />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground w-full">
                <span className="font-medium shrink-0">
                  {download.progress.percent.toFixed(1)}%
                </span>
                <div className="flex flex-wrap items-center gap-3 min-w-0 flex-1">
                  {download.progress.downloaded && download.progress.total && (
                    <span className="truncate max-w-[100px]">
                      {download.progress.downloaded} / {download.progress.total}
                    </span>
                  )}
                  {download.progress.currentSpeed && (
                    <span className="truncate max-w-[80px]">{download.progress.currentSpeed}</span>
                  )}
                  {download.progress.eta && (
                    <span className="truncate max-w-[80px]">ETA: {download.progress.eta}</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Error message */}
          {download.status === 'error' && download.error && (
            <p className="text-xs text-destructive line-clamp-2 w-full overflow-hidden">
              {download.error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
