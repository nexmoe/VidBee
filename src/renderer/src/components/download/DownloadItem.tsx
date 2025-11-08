import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { ImageWithPlaceholder } from '@renderer/components/ui/image-with-placeholder'
import { Progress } from '@renderer/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  FolderOpen,
  Loader2,
  Play,
  Trash2,
  X
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
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

const generateFilePathCandidates = (
  downloadPath: string,
  title: string,
  format: string,
  savedFileName?: string
): string[] => {
  const candidateFileNames = savedFileName
    ? [savedFileName]
    : [`${title} via VidBee.${format}`, `${title}.${format}`]
  const normalizedDownloadPath = downloadPath.replace(/\\/g, '/')
  return Array.from(
    new Set(candidateFileNames.map((fileName) => `${normalizedDownloadPath}/${fileName}`))
  )
}

const tryFileOperation = async (
  paths: string[],
  operation: (filePath: string) => Promise<boolean>
): Promise<boolean> => {
  for (const filePath of paths) {
    const success = await operation(filePath)
    if (success) {
      return true
    }
  }
  return false
}

interface DownloadItemProps {
  download: DownloadRecord
}

type MetadataDetail = {
  label: string
  value: ReactNode
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

const formatDateShort = (timestamp?: number) => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
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

  // Track if the file exists
  const [fileExists, setFileExists] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  // Check if file exists when download data changes
  useEffect(() => {
    const checkFileExists = async () => {
      if (!download.title || !download.downloadPath) {
        setFileExists(false)
        return
      }

      try {
        const formatForPath = download.format || (download.type === 'audio' ? 'mp3' : 'mp4')
        const filePaths = generateFilePathCandidates(
          download.downloadPath,
          download.title,
          formatForPath,
          download.savedFileName
        )
        for (const filePath of filePaths) {
          const exists = await ipcServices.fs.fileExists(filePath)
          if (exists) {
            setFileExists(true)
            return
          }
        }
        setFileExists(false)
      } catch (error) {
        console.error('Failed to check file existence:', error)
        setFileExists(false)
      }
    }

    checkFileExists()
  }, [
    download.title,
    download.downloadPath,
    download.format,
    download.savedFileName,
    download.type
  ])

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
      const downloadPath = download.downloadPath || settings.downloadPath
      const format = download.format || (download.type === 'audio' ? 'mp3' : 'mp4')
      const filePaths = generateFilePathCandidates(
        downloadPath,
        download.title,
        format,
        download.savedFileName
      )

      const success = await tryFileOperation(filePaths, (filePath) =>
        ipcServices.fs.openFileLocation(filePath)
      )
      if (!success) {
        toast.error(t('notifications.openFolderFailed'))
      }
    } catch (error) {
      console.error('Failed to open file location:', error)
      toast.error(t('notifications.openFolderFailed'))
    }
  }
  // Check if copy to clipboard is available
  const canCopyToClipboard = () => {
    return !!(
      download.title &&
      download.downloadPath &&
      fileExists &&
      (download.savedFileName || download.format)
    )
  }

  // need title, downloadPath, format
  const handleCopyToClipboard = async () => {
    if (!canCopyToClipboard()) {
      toast.error(t('notifications.copyFailed'))
      return
    }

    // Type guard: these values are guaranteed to exist after canCopyToClipboard() check
    const downloadPath = download.downloadPath
    const format = download.format
    const title = download.title

    if (!downloadPath || !format || !title) {
      toast.error(t('notifications.copyFailed'))
      return
    }

    try {
      // Generate file path using downloadPath + title + ext
      const filePaths = generateFilePathCandidates(
        downloadPath,
        title,
        format,
        download.savedFileName
      )

      const success = await tryFileOperation(filePaths, (filePath) =>
        ipcServices.fs.copyFileToClipboard(filePath)
      )
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
      const downloadPath = download.downloadPath || settings.downloadPath
      const format = download.format || (download.type === 'audio' ? 'mp3' : 'mp4')
      const filePaths = generateFilePathCandidates(
        downloadPath,
        download.title,
        format,
        download.savedFileName
      )

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
  const sourceDisplay =
    download.uploader && download.channel && download.uploader !== download.channel
      ? `${download.uploader} • ${download.channel}`
      : download.uploader || download.channel || ''

  const metadataDetails: MetadataDetail[] = []

  if (timestamp) {
    metadataDetails.push({
      label: t('history.date'),
      value: formatDate(timestamp)
    })
  }

  if (sourceDisplay) {
    metadataDetails.push({
      label: t('download.metadata.source'),
      value: sourceDisplay
    })
  }

  if (download.playlistId) {
    metadataDetails.push({
      label: t('download.metadata.playlist'),
      value: (
        <span>
          {download.playlistTitle || t('playlist.untitled')}
          {download.playlistIndex !== undefined && download.playlistSize !== undefined ? (
            <span className="text-muted-foreground/80">
              {` ${t('playlist.positionLabel', {
                index: download.playlistIndex,
                total: download.playlistSize
              })}`}
            </span>
          ) : null}
        </span>
      )
    })
  }

  if (download.duration) {
    metadataDetails.push({
      label: t('history.duration'),
      value: formatDuration(download.duration)
    })
  }

  const selectedFormatSize =
    download.selectedFormat?.filesize || download.selectedFormat?.filesize_approx
  const inlineFileSize = selectedFormatSize ? formatFileSize(selectedFormatSize) : undefined

  const formatLabelValue = download.selectedFormat?.ext
    ? download.selectedFormat.ext.toUpperCase()
    : download.format
      ? download.format.toUpperCase()
      : undefined

  if (formatLabelValue) {
    metadataDetails.push({
      label: t('download.metadata.format'),
      value: formatLabelValue
    })
  }

  const qualityValue = download.selectedFormat?.height
    ? `${download.selectedFormat.height}p${download.selectedFormat.fps === 60 ? '60' : ''}`
    : download.quality

  if (qualityValue) {
    metadataDetails.push({
      label: t('download.metadata.quality'),
      value: qualityValue
    })
  }

  if (inlineFileSize) {
    metadataDetails.push({
      label: t('history.fileSize'),
      value: inlineFileSize
    })
  }

  if (download.codec) {
    metadataDetails.push({
      label: t('download.metadata.codec'),
      value: download.codec
    })
  }

  if (download.savedFileName) {
    metadataDetails.push({
      label: t('download.metadata.savedFile'),
      value: download.savedFileName
    })
  }

  if (download.url) {
    metadataDetails.push({
      label: t('download.metadata.url'),
      value: (
        <a
          href={download.url}
          target="_blank"
          rel="noopener noreferrer"
          className="wrap-break-word text-primary hover:underline"
        >
          {download.url}
        </a>
      )
    })
  }

  // Additional metadata fields
  if (download.description) {
    metadataDetails.push({
      label: t('download.metadata.description'),
      value: <span className="wrap-break-word">{download.description}</span>
    })
  }

  if (download.viewCount !== undefined && download.viewCount !== null) {
    metadataDetails.push({
      label: t('download.metadata.views'),
      value: download.viewCount.toLocaleString()
    })
  }

  if (download.tags && download.tags.length > 0) {
    metadataDetails.push({
      label: t('download.metadata.tags'),
      value: (
        <div className="flex flex-wrap gap-1">
          {download.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0.5">
              {tag}
            </Badge>
          ))}
        </div>
      )
    })
  }

  if (download.downloadPath) {
    metadataDetails.push({
      label: t('download.metadata.downloadPath'),
      value: <span className="wrap-break-word font-mono text-xs">{download.downloadPath}</span>
    })
  }

  // Timestamps
  if (download.createdAt && download.createdAt !== timestamp) {
    metadataDetails.push({
      label: t('download.metadata.createdAt'),
      value: formatDate(download.createdAt)
    })
  }

  if (download.startedAt) {
    metadataDetails.push({
      label: t('download.metadata.startedAt'),
      value: formatDate(download.startedAt)
    })
  }

  if (download.completedAt && download.completedAt !== timestamp) {
    metadataDetails.push({
      label: t('download.metadata.completedAt'),
      value: formatDate(download.completedAt)
    })
  }

  // Speed
  if (download.speed) {
    metadataDetails.push({
      label: t('download.metadata.speed'),
      value: download.speed
    })
  }

  // File size (if different from inlineFileSize)
  if (download.fileSize && download.fileSize !== selectedFormatSize) {
    metadataDetails.push({
      label: t('download.metadata.fileSize'),
      value: formatFileSize(download.fileSize)
    })
  }

  // Selected format details
  if (download.selectedFormat) {
    if (download.selectedFormat.width) {
      metadataDetails.push({
        label: t('download.metadata.width'),
        value: `${download.selectedFormat.width}px`
      })
    }

    if (download.selectedFormat.height && !qualityValue) {
      metadataDetails.push({
        label: t('download.metadata.height'),
        value: `${download.selectedFormat.height}px`
      })
    }

    if (download.selectedFormat.fps) {
      metadataDetails.push({
        label: t('download.metadata.fps'),
        value: `${download.selectedFormat.fps}`
      })
    }

    if (download.selectedFormat.vcodec) {
      metadataDetails.push({
        label: t('download.metadata.videoCodec'),
        value: download.selectedFormat.vcodec
      })
    }

    if (download.selectedFormat.acodec) {
      metadataDetails.push({
        label: t('download.metadata.audioCodec'),
        value: download.selectedFormat.acodec
      })
    }

    if (download.selectedFormat.format_note) {
      metadataDetails.push({
        label: t('download.metadata.formatNote'),
        value: download.selectedFormat.format_note
      })
    }

    if (download.selectedFormat.protocol) {
      metadataDetails.push({
        label: t('download.metadata.protocol'),
        value: download.selectedFormat.protocol.toUpperCase()
      })
    }
  }

  const hasMetadataDetails = metadataDetails.length > 0

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
                {(statusIcon || statusText) && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    {statusIcon}
                    <span>{statusText}</span>
                  </div>
                )}
                {timestamp ? (
                  <span className="truncate text-muted-foreground/80">
                    {formatDateShort(timestamp)}
                  </span>
                ) : null}
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                {/* Source link */}
                {(sourceDisplay || download.url) &&
                  (download.url ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a
                          href={download.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="max-w-[180px] truncate hover:text-primary transition-colors"
                        >
                          {sourceDisplay || download.url}
                        </a>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs wrap-break-word">
                        <p>{download.url}</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="truncate">{sourceDisplay}</span>
                  ))}

                {/* Playlist info */}
                {download.playlistId && (
                  <>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 shrink-0">
                      {t('playlist.badgeLabel')}
                    </Badge>
                    <span className="max-w-[200px] truncate">
                      {download.playlistTitle || t('playlist.untitled')}
                      {download.playlistIndex !== undefined &&
                        download.playlistSize !== undefined &&
                        ` (${download.playlistIndex}/${download.playlistSize})`}
                    </span>
                  </>
                )}

                {/* Quality badge */}
                {(download.selectedFormat?.height || download.quality) && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 shrink-0">
                    {download.selectedFormat?.height
                      ? `${download.selectedFormat.height}p${download.selectedFormat.fps === 60 ? '60' : ''}`
                      : download.quality}
                  </Badge>
                )}

                {/* File size */}
                {inlineFileSize && <span>{inlineFileSize}</span>}

                {/* Details toggle */}
                {hasMetadataDetails && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={detailsOpen ? 'default' : 'ghost'}
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        type="button"
                        onClick={() => setDetailsOpen((prev) => !prev)}
                      >
                        {detailsOpen ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{detailsOpen ? t('download.hideDetails') : t('download.showDetails')}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              {detailsOpen && hasMetadataDetails && (
                <div className="space-y-2 rounded-md border border-dashed border-border/60 bg-muted/30 p-3 text-xs">
                  {metadataDetails.map((item, index) => (
                    <div key={`${item.label}-${index}`} className="flex gap-3">
                      <span className="w-24 shrink-0 text-muted-foreground">{item.label}</span>
                      <span className="flex-1 wrap-break-word text-foreground">{item.value}</span>
                    </div>
                  ))}
                </div>
              )}
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
                            disabled={!canCopyToClipboard()}
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
                            disabled={!canCopyToClipboard()}
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
