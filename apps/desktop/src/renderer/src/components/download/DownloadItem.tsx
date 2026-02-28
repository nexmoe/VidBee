import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { Progress } from '@renderer/components/ui/progress'
import { RemoteImage } from '@renderer/components/ui/remote-image'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@renderer/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import type { DownloadItem as DownloadItemPayload } from '@shared/types'
import {
  DOWNLOAD_FEEDBACK_ISSUE_TITLE,
  FeedbackLinkButtons
} from '@vidbee/ui/components/ui/feedback-link-buttons'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  File,
  FolderOpen,
  Loader2,
  Play,
  RotateCw,
  Trash2,
  X
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  buildFilePathCandidates,
  normalizeSavedFileName
} from '../../../../shared/utils/download-file'
import { ipcServices } from '../../lib/ipc'
import {
  addDownloadAtom,
  type DownloadRecord,
  removeDownloadAtom,
  removeHistoryRecordAtom
} from '../../store/downloads'
import { settingsAtom } from '../../store/settings'
import { useAppInfo } from '../feedback/FeedbackLinks'

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
  if (download.type === 'audio') {
    return sanitizeCodec(format.acodec)
  }
  return sanitizeCodec(format.vcodec) ?? sanitizeCodec(format.acodec)
}

interface DownloadItemProps {
  download: DownloadRecord
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
}

interface MetadataDetail {
  label: string
  value: ReactNode
}

const formatFileSize = (bytes?: number) => {
  if (!bytes) {
    return ''
  }
  const sizes = ['B', 'KB', 'MB', 'GB']
  const order = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1)
  return `${(bytes / 1024 ** order).toFixed(1)} ${sizes[order]}`
}

const formatDuration = (seconds?: number) => {
  if (!seconds) {
    return ''
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

const formatDate = (timestamp?: number) => {
  if (!timestamp) {
    return ''
  }
  return new Date(timestamp).toLocaleString()
}

const formatDateShort = (timestamp?: number) => {
  if (!timestamp) {
    return ''
  }
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
  const appInfo = useAppInfo()
  const settings = useAtomValue(settingsAtom)
  const addDownload = useSetAtom(addDownloadAtom)
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
  const [activeTab, setActiveTab] = useState<'details' | 'logs'>('details')
  const [pendingTab, setPendingTab] = useState<'details' | 'logs' | null>(null)
  const [logAutoScroll, setLogAutoScroll] = useState(true)
  const logContainerRef = useRef<HTMLDivElement | null>(null)
  const lastSheetOpenRef = useRef(false)
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)

  // Check if file exists when download data changes
  useEffect(() => {
    const checkFileExists = async () => {
      if (!(download.title && download.downloadPath)) {
        setFileExists(false)
        return
      }

      try {
        const formatForPath = resolvedExtension
        const filePaths = buildFilePathCandidates(
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
    if (isHistory) {
      return
    }
    try {
      await ipcServices.download.cancelDownload(download.id)
      removeDownload(download.id)
    } catch (error) {
      console.error('Failed to cancel download:', error)
    }
  }

  const handleRetryDownload = async () => {
    if (!download.url) {
      toast.error(t('errors.emptyUrl'))
      return
    }
    const id = `download_${Date.now()}_${Math.random().toString(36).substring(7)}`
    const customDownloadPath = download.downloadPath?.trim() || undefined
    const formatId = download.selectedFormat?.format_id

    const downloadItem: DownloadItemPayload = {
      id,
      url: download.url,
      title: download.title || t('download.fetchingVideoInfo'),
      thumbnail: download.thumbnail,
      type: download.type,
      status: 'pending',
      progress: { percent: 0 },
      duration: download.duration,
      description: download.description,
      channel: download.channel,
      uploader: download.uploader,
      viewCount: download.viewCount,
      tags: download.tags,
      selectedFormat: download.selectedFormat,
      playlistId: download.playlistId,
      playlistTitle: download.playlistTitle,
      playlistIndex: download.playlistIndex,
      playlistSize: download.playlistSize,
      origin: download.origin,
      subscriptionId: download.subscriptionId,
      createdAt: Date.now()
    }

    try {
      const started = await ipcServices.download.startDownload(id, {
        url: download.url,
        type: download.type,
        format: formatId,
        audioFormat: download.type === 'video' ? 'best' : undefined,
        customDownloadPath,
        tags: download.tags,
        origin: download.origin,
        subscriptionId: download.subscriptionId
      })
      if (!started) {
        toast.info(t('notifications.downloadAlreadyQueued'))
        return
      }
      addDownload(downloadItem)
    } catch (error) {
      console.error('Failed to retry download:', error)
      toast.error(t('notifications.downloadFailed'))
    }
  }

  const handleOpenFolder = async () => {
    try {
      const downloadPath = download.downloadPath || settings.downloadPath
      const format = resolvedExtension
      const filePaths = buildFilePathCandidates(
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

  const handleOpenFile = async () => {
    try {
      const downloadPath = download.downloadPath || settings.downloadPath
      if (!(downloadPath && download.title)) {
        toast.error(t('notifications.openFileFailed'))
        return
      }
      const format = resolvedExtension
      const filePaths = buildFilePathCandidates(
        downloadPath,
        download.title,
        format,
        download.savedFileName
      )

      const success = await tryFileOperation(filePaths, (filePath) =>
        ipcServices.fs.openFile(filePath)
      )
      if (!success) {
        toast.error(t('notifications.openFileFailed'))
      }
    } catch (error) {
      console.error('Failed to open file:', error)
      toast.error(t('notifications.openFileFailed'))
    }
  }

  const handleCopyLink = async () => {
    if (!download.url) {
      toast.error(t('notifications.copyFailed'))
      return
    }

    if (!navigator.clipboard?.writeText) {
      toast.error(t('notifications.copyFailed'))
      return
    }

    try {
      await navigator.clipboard.writeText(download.url)
      toast.success(t('notifications.urlCopied'))
    } catch (error) {
      console.error('Failed to copy link:', error)
      toast.error(t('notifications.copyFailed'))
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

    if (!(downloadPath && title)) {
      toast.error(t('notifications.copyFailed'))
      return
    }

    try {
      // Generate file path using downloadPath + title + ext
      const filePaths = buildFilePathCandidates(downloadPath, title, format, download.savedFileName)

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

  const handleDeleteFile = async () => {
    try {
      const downloadPath = download.downloadPath || settings.downloadPath
      if (!(downloadPath && download.title)) {
        toast.error(t('notifications.removeFailed'))
        return
      }

      const format = resolvedExtension
      const filePaths = buildFilePathCandidates(
        downloadPath,
        download.title,
        format,
        download.savedFileName
      )

      const deleted = await tryFileOperation(filePaths, (filePath) =>
        ipcServices.fs.deleteFile(filePath)
      )

      if (!deleted) {
        toast.error(t('notifications.removeFailed'))
        return
      }

      setFileExists(false)
      if (isHistory) {
        await ipcServices.history.removeHistoryItem(download.id)
        removeHistory(download.id)
      } else {
        removeDownload(download.id)
      }
    } catch (error) {
      console.error('Failed to delete file:', error)
      toast.error(t('notifications.removeFailed'))
    }
  }

  const handleDeleteRecord = async () => {
    try {
      if (isHistory) {
        await ipcServices.history.removeHistoryItem(download.id)
        removeHistory(download.id)
      } else {
        removeDownload(download.id)
      }
    } catch (error) {
      console.error('Failed to remove record:', error)
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
  const isInProgressStatus =
    download.status === 'downloading' ||
    download.status === 'processing' ||
    download.status === 'pending'
  const isCompletedStatus = download.status === 'completed'
  const canRetry = download.status === 'error'
  const showCopyAction = download.status === 'completed' && fileExists
  const showOpenFolderAction = Boolean(
    download.title && (download.downloadPath || settings.downloadPath)
  )
  const showInlineProgress = Boolean(
    progressInfo && download.status !== 'completed' && download.status !== 'error'
  )
  const canCopyLink = Boolean(download.url)
  const canOpenFile = isCompletedStatus && fileExists
  const canDeleteFile = isCompletedStatus && fileExists
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
          className="wrap-break-word relative z-20 text-primary hover:underline"
          href={download.url}
          rel="noopener noreferrer"
          target="_blank"
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
            <Badge className="px-1.5 py-0.5 text-[10px]" key={tag} variant="secondary">
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
  const logContent = download.ytDlpLog ?? ''
  const hasLogContent = logContent.trim().length > 0
  const ytDlpCommand = download.ytDlpCommand?.trim()
  const hasYtDlpCommand = Boolean(ytDlpCommand)
  const canShowSheet = hasMetadataDetails || isInProgressStatus || hasLogContent

  const isSelectedHistory = selectionEnabled && isSelected

  useEffect(() => {
    const wasOpen = lastSheetOpenRef.current
    lastSheetOpenRef.current = sheetOpen
    if (!sheetOpen || wasOpen) {
      return
    }
    const defaultTab = hasMetadataDetails ? 'details' : 'logs'
    setActiveTab(pendingTab ?? defaultTab)
    setPendingTab(null)
    setLogAutoScroll(true)
  }, [hasMetadataDetails, pendingTab, sheetOpen])

  useEffect(() => {
    if (!(sheetOpen && logAutoScroll && logContent)) {
      return
    }
    const container = logContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [logAutoScroll, logContent, sheetOpen])

  const handleLogScroll = () => {
    const container = logContainerRef.current
    if (!container) {
      return
    }
    const { scrollTop, scrollHeight, clientHeight } = container
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 24
    setLogAutoScroll(isNearBottom)
  }

  const openLogsSheet = () => {
    if (!canShowSheet) {
      return
    }
    setPendingTab(sheetOpen ? null : 'logs')
    setActiveTab('logs')
    setLogAutoScroll(true)
    setSheetOpen(true)
  }

  return (
    <ContextMenu onOpenChange={setIsContextMenuOpen}>
      <ContextMenuTrigger asChild>
        <div
          className={`group relative w-full max-w-full overflow-hidden px-6 py-2 transition-colors ${
            isSelectedHistory || isContextMenuOpen ? 'bg-primary/10' : ''
          }`}
        >
          <div
            className={`flex w-full flex-col gap-2 sm:flex-row sm:gap-3 ${
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
            <div className="pointer-events-none relative z-20 aspect-video h-14 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-background/60">
              {selectionEnabled && (
                <div
                  className={`pointer-events-auto absolute top-1 left-1 z-30 rounded-md transition ${
                    isSelected
                      ? 'opacity-100'
                      : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
                  }`}
                >
                  <Checkbox
                    aria-label={t('history.selectItem')}
                    checked={Boolean(isSelected)}
                    onCheckedChange={() => onToggleSelect?.(download.id)}
                    onClick={(event) => event.stopPropagation()}
                  />
                </div>
              )}
              <RemoteImage
                alt={download.title}
                className="h-full w-full object-cover"
                fallbackIcon={<Play className="h-4 w-4" />}
                src={download.thumbnail}
              />
            </div>

            {/* Content */}
            <div className="pointer-events-none min-w-0 max-w-full flex-1 overflow-hidden">
              <div className="flex h-14 w-full flex-col items-center justify-center gap-1.5 sm:flex-row sm:justify-between sm:gap-2">
                <div className="min-w-0 max-w-full flex-1 items-center space-y-1.5 overflow-hidden">
                  <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 overflow-hidden">
                    <p className="wrap-break-word line-clamp-1 flex-1 font-medium text-sm">
                      {download.title}
                    </p>
                    {download.type === 'audio' && (
                      <Badge className="shrink-0 px-1.5 py-0.5 text-[10px]" variant="secondary">
                        {t('download.audio')}
                      </Badge>
                    )}
                    {isSubscriptionDownload && (
                      <Badge className="shrink-0 px-1.5 py-0.5 text-[10px]" variant="secondary">
                        {t('subscriptions.labels.subscription')}
                      </Badge>
                    )}
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    {/* Status */}
                    {statusIcon && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex shrink-0 items-center">{statusIcon}</div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{statusText}</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {showInlineProgress && (
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 font-medium">
                          {(progressInfo?.percent ?? 0).toFixed(1)}%
                        </span>
                        {progressInfo?.downloaded && progressInfo?.total && (
                          <span className="max-w-[120px] truncate">
                            {progressInfo.downloaded} / {progressInfo.total}
                          </span>
                        )}
                        {progressInfo?.currentSpeed && (
                          <span className="max-w-[80px] truncate">{progressInfo.currentSpeed}</span>
                        )}
                        {progressInfo?.eta && (
                          <span className="max-w-[80px] truncate">ETA: {progressInfo.eta}</span>
                        )}
                      </div>
                    )}
                    {/* Timestamp */}
                    {timestamp && (
                      <span className="shrink-0 truncate">{formatDateShort(timestamp)}</span>
                    )}
                    {/* Quality */}
                    {qualityLabel && (
                      <>
                        {(statusIcon || timestamp) && (
                          <span className="shrink-0 text-muted-foreground/60">•</span>
                        )}
                        <span className="shrink-0">{qualityLabel}</span>
                      </>
                    )}
                    {/* File size */}
                    {inlineFileSize && (
                      <>
                        {(statusIcon || timestamp || qualityLabel) && (
                          <span className="shrink-0 text-muted-foreground/60">•</span>
                        )}
                        <span className="shrink-0">{inlineFileSize}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className={`${actionsContainerClass} pointer-events-auto`}>
                  {canRetry && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          className="h-8 w-8 shrink-0 rounded-full"
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleRetryDownload()
                          }}
                          size="icon"
                          variant="ghost"
                        >
                          <RotateCw className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t('download.retry')}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {isHistory ? (
                    <>
                      {showCopyAction && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              className="h-8 w-8 shrink-0 rounded-full"
                              disabled={!canCopyToClipboard()}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleCopyToClipboard()
                              }}
                              size="icon"
                              variant="ghost"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t('history.copyToClipboard')}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {showOpenFolderAction && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              className="h-8 w-8 shrink-0 rounded-full"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleOpenFolder()
                              }}
                              size="icon"
                              variant="ghost"
                            >
                              <FolderOpen className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t('history.openFolder')}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </>
                  ) : (
                    <>
                      {showCopyAction && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              className="h-8 w-8 shrink-0 rounded-full"
                              disabled={!canCopyToClipboard()}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleCopyToClipboard()
                              }}
                              size="icon"
                              variant="ghost"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t('history.copyToClipboard')}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {showOpenFolderAction && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              className="h-8 w-8 shrink-0 rounded-full"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleOpenFolder()
                              }}
                              size="icon"
                              variant="ghost"
                            >
                              <FolderOpen className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t('history.openFolder')}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {(download.status === 'downloading' ||
                        download.status === 'pending' ||
                        download.status === 'processing') && (
                        <Button
                          className="h-8 w-8 shrink-0 rounded-full"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCancel()
                          }}
                          size="icon"
                          variant="ghost"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Progress */}
              {download.progress &&
                download.status !== 'completed' &&
                download.status !== 'error' && (
                  <div className="w-full overflow-hidden bg-background/60">
                    <Progress className="h-1 w-full" value={download.progress.percent} />
                  </div>
                )}

              {/* Error message */}
              {download.status === 'error' && download.error && (
                <div className="flex flex-col gap-1.5">
                  <p className="line-clamp-2 w-full overflow-hidden text-destructive text-xs">
                    {download.error}
                  </p>
                  <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
                    <span className="shrink-0 font-medium text-muted-foreground text-xs">
                      {t('download.feedback.title')}:
                    </span>
                    {canShowSheet && (
                      <Button
                        className="h-6 px-1.5 text-[10px]"
                        onClick={(event) => {
                          event.stopPropagation()
                          openLogsSheet()
                        }}
                        size="sm"
                        variant="outline"
                      >
                        {t('download.viewLogs')}
                      </Button>
                    )}
                    <FeedbackLinkButtons
                      appInfo={appInfo}
                      buttonClassName="h-6 gap-1 px-1.5 text-[10px]"
                      buttonSize="sm"
                      buttonVariant="outline"
                      error={download.error}
                      iconClassName="h-3 w-3"
                      includeAppInfo
                      issueTitle={DOWNLOAD_FEEDBACK_ISSUE_TITLE}
                      onLinkClick={(event) => event.stopPropagation()}
                      showGroupSeparator={canShowSheet}
                      sourceUrl={download.url}
                      wrapperClassName="flex flex-wrap items-center gap-1.5"
                      ytDlpCommand={download.ytDlpCommand}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Video Details Sheet */}
          {canShowSheet && (
            <Sheet onOpenChange={setSheetOpen} open={sheetOpen}>
              <SheetContent className="flex w-full flex-col p-0 sm:max-w-lg" side="right">
                <div className="flex h-full flex-col overflow-hidden">
                  <SheetHeader className="shrink-0 border-b px-6 pt-6 pb-4">
                    <SheetTitle className="line-clamp-2">{download.title}</SheetTitle>
                    <SheetDescription>{t('download.videoInfo')}</SheetDescription>
                  </SheetHeader>
                  <Tabs
                    className="flex-1 overflow-hidden"
                    onValueChange={(value) => setActiveTab(value as 'details' | 'logs')}
                    value={activeTab}
                  >
                    <div className="px-6 pt-4">
                      <TabsList>
                        <TabsTrigger disabled={!hasMetadataDetails} value="details">
                          {t('download.detailsTab')}
                        </TabsTrigger>
                        <TabsTrigger value="logs">{t('download.logsTab')}</TabsTrigger>
                      </TabsList>
                    </div>
                    <TabsContent className="flex-1 overflow-y-auto px-6 py-4" value="details">
                      <div className="space-y-4">
                        {metadataDetails.map((item, index) => (
                          <div className="flex flex-col gap-1" key={`${item.label}-${index}`}>
                            <span className="font-medium text-muted-foreground text-sm">
                              {item.label}
                            </span>
                            <div className="break-words text-foreground text-sm">{item.value}</div>
                          </div>
                        ))}
                      </div>
                    </TabsContent>
                    <TabsContent
                      className="flex flex-1 flex-col gap-3 overflow-hidden px-6 py-4"
                      value="logs"
                    >
                      <div className="flex items-center justify-between text-muted-foreground text-xs">
                        <span>
                          {isInProgressStatus
                            ? t('download.logs.live')
                            : t('download.logs.history')}
                        </span>
                        {logAutoScroll ? null : (
                          <span className="text-muted-foreground/70">
                            {t('download.logs.scrollPaused')}
                          </span>
                        )}
                      </div>
                      {hasYtDlpCommand && (
                        <div className="rounded-md border border-border/60 bg-muted/20 p-2">
                          <div className="font-medium text-[11px] text-muted-foreground">
                            {t('download.logs.command')}
                          </div>
                          <div className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">
                            {ytDlpCommand}
                          </div>
                        </div>
                      )}
                      <div className="min-h-0 flex-1 rounded-md border border-border/60 bg-muted/30">
                        <div
                          className="h-full overflow-y-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed"
                          onScroll={handleLogScroll}
                          ref={logContainerRef}
                        >
                          {hasLogContent ? logContent : t('download.logs.empty')}
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {isInProgressStatus ? (
          <>
            {canRetry && (
              <ContextMenuItem onClick={handleRetryDownload}>
                <RotateCw className="h-4 w-4" />
                {t('download.retry')}
              </ContextMenuItem>
            )}
            <ContextMenuItem disabled={!showOpenFolderAction} onClick={handleOpenFolder}>
              <FolderOpen className="h-4 w-4" />
              {t('history.openFileLocation')}
            </ContextMenuItem>
            <ContextMenuItem disabled={!canCopyLink} onClick={handleCopyLink}>
              <span aria-hidden="true" className="h-4 w-4 shrink-0" />
              {t('history.copyUrl')}
            </ContextMenuItem>
            {canShowSheet && (
              <ContextMenuItem onClick={() => setSheetOpen(true)}>
                <span aria-hidden="true" className="h-4 w-4 shrink-0" />
                {t('download.showDetails')}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handleCancel}>
              <X className="h-4 w-4" />
              {t('download.cancel')}
            </ContextMenuItem>
          </>
        ) : (
          <>
            {isCompletedStatus && (
              <ContextMenuItem disabled={!showCopyAction} onClick={handleCopyToClipboard}>
                <Copy className="h-4 w-4" />
                {t('history.copyToClipboard')}
              </ContextMenuItem>
            )}
            {canRetry && (
              <ContextMenuItem onClick={handleRetryDownload}>
                <RotateCw className="h-4 w-4" />
                {t('download.retry')}
              </ContextMenuItem>
            )}
            <ContextMenuItem disabled={!canOpenFile} onClick={handleOpenFile}>
              <File className="h-4 w-4" />
              {t('history.openFile')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!showOpenFolderAction} onClick={handleOpenFolder}>
              <FolderOpen className="h-4 w-4" />
              {t('history.openFileLocation')}
            </ContextMenuItem>
            <ContextMenuItem disabled={!canCopyLink} onClick={handleCopyLink}>
              <span aria-hidden="true" className="h-4 w-4 shrink-0" />
              {t('history.copyUrl')}
            </ContextMenuItem>
            {canShowSheet && (
              <ContextMenuItem onClick={() => setSheetOpen(true)}>
                <span aria-hidden="true" className="h-4 w-4 shrink-0" />
                {t('download.showDetails')}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!canDeleteFile} onClick={handleDeleteFile}>
              <Trash2 className="h-4 w-4" />
              {t('history.deleteFile')}
            </ContextMenuItem>
            <ContextMenuItem onClick={handleDeleteRecord}>
              <span aria-hidden="true" className="h-4 w-4 shrink-0" />
              {t('history.deleteRecord')}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
