import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Progress } from '@renderer/components/ui/progress'
import { RemoteImage } from '@renderer/components/ui/remote-image'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@renderer/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  FolderOpen,
  Info,
  Loader2,
  Play,
  Trash2,
  X
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcServices } from '../../lib/ipc'
import {
  type DownloadRecord,
  removeDownloadAtom,
  removeHistoryRecordAtom
} from '../../store/downloads'
import { settingsAtom } from '../../store/settings'

const normalizeSavedFileName = (fileName?: string): string | undefined => {
  if (!fileName) {
    return undefined
  }
  const trimmed = fileName.trim()
  if (!trimmed) {
    return undefined
  }
  return trimmed.replace(/\.f\d+(?=\.[^.]+$)/i, '')
}

const generateFilePathCandidates = (
  downloadPath: string,
  title: string,
  format: string,
  savedFileName?: string
): string[] => {
  const normalizedDownloadPath = downloadPath.replace(/\\/g, '/')
  const safeTitle = title.trim() || 'Unknown'

  const savedNameCandidates: string[] = []
  const trimmedSavedFileName = savedFileName?.trim()
  if (trimmedSavedFileName) {
    const normalized = normalizeSavedFileName(trimmedSavedFileName)
    if (normalized) {
      savedNameCandidates.push(normalized)
    }
    if (!normalized || normalized !== trimmedSavedFileName) {
      savedNameCandidates.push(trimmedSavedFileName)
    }
  }

  const candidateFileNames =
    savedNameCandidates.length > 0
      ? savedNameCandidates
      : [`${safeTitle} via VidBee.${format}`, `${safeTitle}.${format}`]
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

const getSavedFileExtension = (fileName?: string): string | undefined => {
  const normalized = normalizeSavedFileName(fileName)
  if (!normalized) {
    return undefined
  }
  if (!normalized.includes('.')) {
    return undefined
  }
  const ext = normalized.split('.').pop()
  return ext?.toLowerCase()
}

const resolveDownloadExtension = (download: DownloadRecord): string => {
  const savedExt = getSavedFileExtension(download.savedFileName)
  if (savedExt) {
    return savedExt
  }
  const selectedExt = download.selectedFormat?.ext?.toLowerCase()
  if (selectedExt) {
    return selectedExt
  }
  return download.type === 'audio' ? 'mp3' : 'mp4'
}

const getFormatLabel = (download: DownloadRecord): string | undefined => {
  if (download.selectedFormat?.ext) {
    return download.selectedFormat.ext.toUpperCase()
  }
  const savedExt = getSavedFileExtension(download.savedFileName)
  return savedExt ? savedExt.toUpperCase() : undefined
}

const getQualityLabel = (download: DownloadRecord): string | undefined => {
  const format = download.selectedFormat
  if (!format) {
    return undefined
  }
  if (format.height) {
    return `${format.height}p${format.fps === 60 ? '60' : ''}`
  }
  if (format.format_note) {
    return format.format_note
  }
  if (typeof format.quality === 'number') {
    return format.quality.toString()
  }
  return undefined
}

const sanitizeCodec = (codec?: string | null): string | undefined => {
  if (!codec || codec === 'none') {
    return undefined
  }
  return codec
}

const getCodecLabel = (download: DownloadRecord): string | undefined => {
  const format = download.selectedFormat
  if (!format) {
    return undefined
  }
  if (download.type === 'audio' || download.type === 'extract') {
    return sanitizeCodec(format.acodec)
  }
  return sanitizeCodec(format.vcodec) ?? sanitizeCodec(format.acodec)
}

interface DownloadItemProps {
  download: DownloadRecord
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
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
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function DownloadItem({ download, isSelected = false, onToggleSelect }: DownloadItemProps) {
  const { t } = useTranslation()
  const settings = useAtomValue(settingsAtom)
  const removeDownload = useSetAtom(removeDownloadAtom)
  const removeHistory = useSetAtom(removeHistoryRecordAtom)
  const isHistory = download.entryType === 'history'
  const isSubscriptionDownload = download.origin === 'subscription'
  const subscriptionLabel = download.subscriptionId ?? t('subscriptions.labels.unknown')
  const timestamp = download.completedAt ?? download.downloadedAt ?? download.createdAt
  const actionsContainerClass =
    'relative z-20 flex shrink-0 flex-wrap items-center justify-end gap-1 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity'
  const resolvedExtension = resolveDownloadExtension(download)
  const normalizedSavedFileName = normalizeSavedFileName(download.savedFileName)
  const selectionEnabled = isHistory && Boolean(onToggleSelect)

  // Track if the file exists
  const [fileExists, setFileExists] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  // Check if file exists when download data changes
  useEffect(() => {
    const checkFileExists = async () => {
      if (!download.title || !download.downloadPath) {
        setFileExists(false)
        return
      }

      try {
        const formatForPath = resolvedExtension
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
  }, [download.title, download.downloadPath, download.savedFileName, resolvedExtension])

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
      const format = resolvedExtension
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
    return Boolean(download.title && download.downloadPath && fileExists)
  }

  // need title, downloadPath, format
  const handleCopyToClipboard = async () => {
    if (!canCopyToClipboard()) {
      toast.error(t('notifications.copyFailed'))
      return
    }

    // Type guard: these values are guaranteed to exist after canCopyToClipboard() check
    const downloadPath = download.downloadPath
    const format = resolvedExtension
    const title = download.title

    if (!downloadPath || !title) {
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
      const format = resolvedExtension
      const filePaths = generateFilePathCandidates(
        downloadPath,
        download.title,
        format,
        download.savedFileName
      )

      // Remove from history first
      await ipcServices.history.removeHistoryItem(download.id)

      // Then try to delete the file
      const deleted = await tryFileOperation(filePaths, (filePath) =>
        ipcServices.fs.deleteFile(filePath)
      )
      if (!deleted) {
        console.warn('Failed to delete download file for history item:', download.id)
      }

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
  const progressInfo = download.progress
  const showInlineProgress = Boolean(
    progressInfo && download.status !== 'completed' && download.status !== 'error'
  )
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

  const formatLabelValue = getFormatLabel(download)

  if (formatLabelValue) {
    metadataDetails.push({
      label: t('download.metadata.format'),
      value: formatLabelValue
    })
  }

  const qualityLabel = getQualityLabel(download)

  if (qualityLabel) {
    metadataDetails.push({
      label: t('download.metadata.quality'),
      value: qualityLabel
    })
  }

  if (inlineFileSize) {
    metadataDetails.push({
      label: t('history.fileSize'),
      value: inlineFileSize
    })
  }

  const codecValue = getCodecLabel(download)
  if (codecValue) {
    metadataDetails.push({
      label: t('download.metadata.codec'),
      value: codecValue
    })
  }

  if (normalizedSavedFileName || download.savedFileName) {
    metadataDetails.push({
      label: t('download.metadata.savedFile'),
      value: normalizedSavedFileName ?? download.savedFileName
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
          className="relative z-20 wrap-break-word text-primary hover:underline"
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

    if (download.selectedFormat.height && !qualityLabel) {
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

  if (isSubscriptionDownload) {
    metadataDetails.push({
      label: t('download.metadata.subscription'),
      value: subscriptionLabel
    })
  }

  const hasMetadataDetails = metadataDetails.length > 0

  const isSelectedHistory = selectionEnabled && isSelected

  return (
    <div
      className={`group relative w-full max-w-full overflow-hidden rounded-lg border border-transparent transition-colors ${
        isSelectedHistory ? 'bg-primary/10' : ''
      }`}
    >
      {isSelectedHistory && (
        <div className="absolute left-0 top-0 h-full w-1 bg-primary/70" aria-hidden="true" />
      )}
      <div
        className={`flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 ${
          selectionEnabled ? 'cursor-pointer' : ''
        }`}
        {...(selectionEnabled
          ? {
              onClick: () => onToggleSelect?.(download.id),
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onToggleSelect?.(download.id)
                }
              },
              role: 'button',
              tabIndex: 0,
              'aria-label': t('history.selectItem')
            }
          : {})}
      >
        {/* Thumbnail */}
        <div className="relative z-20 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-background/60 w-20 h-14 pointer-events-none">
          {selectionEnabled && (
            <div
              className={`absolute left-1 top-1 z-30 rounded-md transition pointer-events-auto ${
                isSelected
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
              }`}
            >
              <Checkbox
                checked={Boolean(isSelected)}
                onCheckedChange={() => onToggleSelect?.(download.id)}
                onClick={(event) => event.stopPropagation()}
                aria-label={t('history.selectItem')}
              />
            </div>
          )}
          <RemoteImage
            src={download.thumbnail}
            alt={download.title}
            className="w-full h-full object-cover"
            fallbackIcon={<Play className="h-4 w-4" />}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 max-w-full space-y-1.5 overflow-hidden pointer-events-none">
          <div className="flex w-full flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
            <div className="flex-1 min-w-0 max-w-full space-y-1 overflow-hidden">
              <div className="w-full min-w-0 overflow-hidden flex flex-wrap items-center gap-1.5">
                <p className="flex-1 wrap-break-word text-sm font-medium line-clamp-1">
                  {download.title}
                </p>
                {isSubscriptionDownload && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 shrink-0">
                    {t('subscriptions.labels.subscription')}
                  </Badge>
                )}
              </div>
              <div className="flex w-full flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                {/* Status */}
                {statusIcon && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center shrink-0">{statusIcon}</div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{statusText}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                {showInlineProgress && (
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium shrink-0">
                      {(progressInfo?.percent ?? 0).toFixed(1)}%
                    </span>
                    {progressInfo?.downloaded && progressInfo?.total && (
                      <span className="truncate max-w-[120px]">
                        {progressInfo.downloaded} / {progressInfo.total}
                      </span>
                    )}
                    {progressInfo?.currentSpeed && (
                      <span className="truncate max-w-[80px]">{progressInfo.currentSpeed}</span>
                    )}
                    {progressInfo?.eta && (
                      <span className="truncate max-w-[80px]">ETA: {progressInfo.eta}</span>
                    )}
                  </div>
                )}
                {/* Timestamp */}
                {timestamp && (
                  <span className="truncate shrink-0">{formatDateShort(timestamp)}</span>
                )}
                {/* Quality */}
                {qualityLabel && (
                  <>
                    {(statusIcon || timestamp) && (
                      <span className="text-muted-foreground/60 shrink-0">•</span>
                    )}
                    <span className="shrink-0">{qualityLabel}</span>
                  </>
                )}
                {/* File size */}
                {inlineFileSize && (
                  <>
                    {(statusIcon || timestamp || qualityLabel) && (
                      <span className="text-muted-foreground/60 shrink-0">•</span>
                    )}
                    <span className="shrink-0">{inlineFileSize}</span>
                  </>
                )}
              </div>
            </div>
            <div className={`${actionsContainerClass} pointer-events-auto`}>
              {/* Info button - show details in sheet */}
              {hasMetadataDetails && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 rounded-full"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSheetOpen(true)
                      }}
                    >
                      <Info className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('download.showDetails')}</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {isHistory ? (
                <>
                  {download.status === 'completed' && (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 rounded-full"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleCopyToClipboard()
                            }}
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
                            className="h-8 w-8 shrink-0 rounded-full"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleOpenFolder()
                            }}
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
                        className="h-8 w-8 shrink-0 rounded-full"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveHistory()
                        }}
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
                            className="h-8 w-8 shrink-0 rounded-full"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleCopyToClipboard()
                            }}
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
                            className="h-8 w-8 shrink-0 rounded-full"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleOpenFolder()
                            }}
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
                      className="h-8 w-8 shrink-0 rounded-full"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCancel()
                      }}
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
            <div className="bg-background/60 w-full overflow-hidden">
              <Progress value={download.progress.percent} className="h-1 w-full" />
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

      {/* Video Details Sheet */}
      {hasMetadataDetails && (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
            <div className="flex flex-col h-full overflow-hidden">
              <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
                <SheetTitle className="line-clamp-2">{download.title}</SheetTitle>
                <SheetDescription>{t('download.videoInfo')}</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="space-y-4">
                  {metadataDetails.map((item, index) => (
                    <div key={`${item.label}-${index}`} className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-muted-foreground">
                        {item.label}
                      </span>
                      <div className="text-sm text-foreground break-words">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
