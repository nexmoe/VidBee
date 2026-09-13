import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  ContextMenu,
  ContextMenuContent,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useNavigate } from '@tanstack/react-router'
import { getCookieSetupFailureKind } from '@vidbee/downloader-core/cookie-setup'
import { DownloadPlatformIcon } from '@vidbee/ui/components/ui/download-platform-icon'
import {
  DOWNLOAD_FEEDBACK_ISSUE_TITLE,
  FeedbackLinkButtons
} from '@vidbee/ui/components/ui/feedback-link-buttons'
import {
  downloadPlatformDisplayLabel,
  LOCAL_DOWNLOAD_PLATFORM_KEY,
  resolveDownloadPlatform
} from '@vidbee/ui/lib/download-platform'
import { isListIgnoreTarget } from '@vidbee/ui/lib/list-marquee'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  AlertCircle,
  AudioLines,
  Captions,
  CheckCircle2,
  FileAudio,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  RotateCw,
  X
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  buildFilePathCandidates,
  normalizeSavedFileName
} from '../../../../shared/utils/download-file'
import { useCachedThumbnail } from '../../hooks/use-cached-thumbnail'
import { getDownloadErrorGuidance } from '../../lib/download-error-guidance'
import { sendGlitchTipFeedback } from '../../lib/glitchtip-feedback'
import { ipcServices } from '../../lib/ipc'
import { logger } from '../../lib/logger'
import { openContextMenuFromClick } from '../../lib/open-context-menu'
import {
  transcriptLibraryStatusKey,
  transcriptProgressLabelKey
} from '../../lib/transcript-library'
import { isNowPlayingLibraryItem } from '../../lib/transcript-playback'
import { buildTranscriptPlaybackInput } from '../../lib/transcript-playback-source'
import { flyCoverToPlaylistButton } from '../../lib/transcript-playlist-fly'
import { cookieSetupRequestAtom } from '../../store/cookie-setup'
import {
  addDownloadAtom,
  type DownloadRecord,
  removeDownloadAtom,
  removeHistoryRecordAtom
} from '../../store/downloads'
import { settingsAtom } from '../../store/settings'
import {
  playbackPlayingAtom,
  playbackSessionAtom,
  takePlaybackSessionAtom
} from '../../store/transcript-playback'
import { type TranscriptListState, transcriptMapAtom } from '../../store/transcripts'
import { useAppInfo } from '../feedback/FeedbackLinks'
import { TranscriptAudioEqualizer } from '../transcript/TranscriptAudioEqualizer'
import { DownloadRecordContextMenuItems } from './DownloadRecordContextMenuItems'
import { canRetryDownload, getQualityLabel } from './download-item-utils'

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

/**
 * True when yt-dlp's resolved format id does not include the user-picked
 * format id as a `+`-separated component. Used to surface the fallback
 * notice on completed rows so users know their preferred quality wasn't
 * actually delivered.
 */
const didFallbackFromPick = (download: DownloadRecord): boolean => {
  const picked = download.selectedFormat?.format_id
  const resolved = download.resolvedFormatId
  if (!(picked && resolved)) {
    return false
  }
  const parts = resolved
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  return !parts.includes(picked)
}

interface DownloadItemProps {
  download: DownloadRecord
  isSelected?: boolean
  selectionActive?: boolean
  onToggleSelect?: (id: string) => void
}

const formatFileSize = (bytes?: number) => {
  if (!bytes) {
    return ''
  }
  const sizes = ['B', 'KB', 'MB', 'GB']
  const order = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1)
  return `${(bytes / 1024 ** order).toFixed(1)} ${sizes[order]}`
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

export function DownloadItem({
  download,
  isSelected = false,
  selectionActive = false,
  onToggleSelect
}: DownloadItemProps) {
  const { t } = useTranslation()
  const appInfo = useAppInfo()
  const settings = useAtomValue(settingsAtom)
  const setCookieSetupRequest = useSetAtom(cookieSetupRequestAtom)
  const navigate = useNavigate()
  const transcriptMap = useAtomValue(transcriptMapAtom)
  const transcript = transcriptMap[download.id]
  const playbackSession = useAtomValue(playbackSessionAtom)
  const takePlaybackSession = useSetAtom(takePlaybackSessionAtom)
  const playbackPlaying = useAtomValue(playbackPlayingAtom)
  const isNowPlaying = isNowPlayingLibraryItem(playbackSession, download.id)
  const addDownload = useSetAtom(addDownloadAtom)
  const removeDownload = useSetAtom(removeDownloadAtom)
  const removeHistory = useSetAtom(removeHistoryRecordAtom)
  const isHistory = download.entryType === 'history'
  const timestamp = download.completedAt ?? download.downloadedAt ?? download.createdAt
  const resolvedExtension = resolveDownloadExtension(download)
  const selectionEnabled = isHistory && Boolean(onToggleSelect)
  let subtitleStatusLabel: string | undefined
  switch (download.subtitleStatus) {
    case 'downloaded':
      subtitleStatusLabel = t('download.completed')
      break
    case 'unavailable':
      subtitleStatusLabel = t('about.downloadEngine.status.unavailable')
      break
    case 'skipped-auth':
      subtitleStatusLabel = t('download.cookiesSetupNeeded')
      break
    case 'failed':
      subtitleStatusLabel = t('download.error')
      break
    default:
      break
  }
  // Track if the file exists
  const [fileExists, setFileExists] = useState(false)
  const [existingFilePath, setExistingFilePath] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [logAutoScroll, setLogAutoScroll] = useState(true)
  // Saved yt-dlp log fetched on demand for terminal items (live stream is gone).
  const [savedLog, setSavedLog] = useState<string | null>(null)
  const logContainerRef = useRef<HTMLDivElement | null>(null)
  const coverRef = useRef<HTMLDivElement | null>(null)
  const lastSheetOpenRef = useRef(false)
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
  const cachedThumbnail = useCachedThumbnail(download.thumbnail)
  const playbackInput = buildTranscriptPlaybackInput({
    cachedThumbnail,
    download,
    downloadId: download.id,
    fallbackTitle: t('transcript.title'),
    snapshot: transcript ?? null
  })

  // Check if file exists when download data changes
  useEffect(() => {
    const checkFileExists = async () => {
      if (!(download.title && download.downloadPath)) {
        setExistingFilePath(null)
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
            setExistingFilePath(filePath)
            setFileExists(true)
            return
          }
        }
        setExistingFilePath(null)
        setFileExists(false)
      } catch (error) {
        logger.error('Failed to check file existence:', error)
        setExistingFilePath(null)
        setFileExists(false)
      }
    }

    checkFileExists()
  }, [download.title, download.downloadPath, download.savedFileName, resolvedExtension])

  /** Cancel the task and remove its row only after the main process confirms persistence. */
  const handleCancel = async (): Promise<void> => {
    if (isHistory) {
      return
    }
    try {
      const cancelled = await ipcServices.download.cancelDownload(download.id)
      if (cancelled) {
        removeDownload(download.id)
      }
    } catch (error) {
      logger.error('Failed to cancel download:', error)
    }
  }

  /**
   * Pause an in-flight download without dropping the queue row.
   */
  const handlePause = async () => {
    if (isHistory) {
      return
    }
    try {
      await ipcServices.download.pauseDownload(download.id)
    } catch (error) {
      logger.error('Failed to pause download:', error)
    }
  }

  /**
   * Resume a paused download from the preserved partial file.
   */
  const handleResume = async () => {
    if (isHistory) {
      return
    }
    try {
      await ipcServices.download.resumeDownload(download.id)
    } catch (error) {
      logger.error('Failed to resume download:', error)
    }
  }

  const handleRetryDownload = async () => {
    if (!download.url) {
      toast.error(t('errors.emptyUrl'))
      return
    }
    try {
      const retried = await ipcServices.download.retryDownload(download.id)
      if (!retried) {
        toast.info(t('notifications.downloadAlreadyQueued'))
        return
      }
      addDownload({
        ...download,
        status: 'pending',
        progress: { percent: 0 },
        error: undefined
      })
    } catch (error) {
      logger.error('Failed to retry download:', error)
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
      logger.error('Failed to open file location:', error)
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
      logger.error('Failed to open file:', error)
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
      logger.error('Failed to copy link:', error)
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
      logger.error('Failed to copy file to clipboard:', error)
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
      if (
        isHistory ||
        download.status === 'completed' ||
        download.status === 'error' ||
        download.status === 'cancelled'
      ) {
        await ipcServices.history.removeHistoryItem(download.id)
      }
      removeHistory(download.id)
      removeDownload(download.id)
    } catch (error) {
      logger.error('Failed to delete file:', error)
      toast.error(t('notifications.removeFailed'))
    }
  }

  const handleDeleteRecord = async () => {
    try {
      if (
        isHistory ||
        download.status === 'completed' ||
        download.status === 'error' ||
        download.status === 'cancelled'
      ) {
        await ipcServices.history.removeHistoryItem(download.id)
      }
      removeHistory(download.id)
      removeDownload(download.id)
    } catch (error) {
      logger.error('Failed to remove record:', error)
      toast.error(t('notifications.removeFailed'))
    }
  }

  /**
   * Open the transcript page. Captions vs ASR is decided after the page loads.
   */
  const handleOpenTranscript = () => {
    void navigate({
      to: '/downloads/$downloadId/transcript',
      params: { downloadId: download.id }
    })
  }

  const playableInput = {
    ...playbackInput,
    filePath: playbackInput.filePath ?? existingFilePath
  }

  /**
   * Fly this row's cover onto the playback-bar playlist button.
   */
  const flyCoverToPlaylist = (): void => {
    const cover = coverRef.current
    const image = cover?.querySelector('img')
    flyCoverToPlaylistButton({
      from: cover?.getBoundingClientRect() ?? null,
      src: image?.currentSrc || image?.src || cachedThumbnail || download.thumbnail || null
    })
  }

  /**
   * Put this media first in the playlist and start playing it immediately.
   */
  const handlePlayNow = (): boolean => {
    if (!playableInput.filePath) {
      toast.error(t('transcript.mediaMissing'))
      return false
    }
    takePlaybackSession(playableInput)
    flyCoverToPlaylist()
    return true
  }

  /**
   * Queue this media from the context menu and confirm it with a cover fly.
   */
  const handleAddToPlaylist = (): void => {
    handlePlayNow()
  }

  const isPausedDownload = download.subStatus === 'paused' || download.internalStatus === 'paused'

  const getStatusIcon = () => {
    switch (download.status) {
      case 'completed':
        return null
      case 'error':
        return <AlertCircle className="h-4 w-4 text-destructive" />
      case 'downloading':
      case 'processing':
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />
      case 'pending':
        if (isPausedDownload) {
          return <Pause className="h-4 w-4 text-amber-500" />
        }
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
        if (isPausedDownload) {
          return t('download.paused')
        }
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
  const canPauseDownload =
    !(isHistory || isPausedDownload) &&
    (download.status === 'downloading' || download.status === 'processing')
  const canResumeDownload = !isHistory && isPausedDownload
  const isCompletedStatus = download.status === 'completed'
  const isTerminalStatus =
    download.status === 'completed' ||
    download.status === 'error' ||
    download.status === 'cancelled'
  const platform = resolveDownloadPlatform(download.url)
  const isLocalMedia = platform.key === LOCAL_DOWNLOAD_PLATFORM_KEY
  const transcriptListState = transcript?.listState ?? 'none'
  const canRetry = !isLocalMedia && canRetryDownload(download.status)
  const subtitleLanguageLabel = download.subtitleLanguages?.filter(Boolean).join(', ')
  const subtitleRow = resolveDownloadSubtitleRow({
    languages: subtitleLanguageLabel,
    sourceKind: transcript?.sourceKind,
    stage: transcript?.stage,
    subtitleStatus: download.subtitleStatus,
    subtitleStatusLabel,
    t,
    transcriptError: transcript?.error,
    transcriptListState
  })
  const canPlayMedia = isCompletedStatus && Boolean(playableInput.filePath)
  const actionsAlwaysVisible = isInProgressStatus
  const hoverActionsClass = `flex items-center justify-end gap-0.5 transition-opacity ${
    actionsAlwaysVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
  }`
  const showOpenFolderAction = Boolean(
    download.title && (download.downloadPath || settings.downloadPath)
  )
  const showInlineProgress = Boolean(
    progressInfo && download.status !== 'completed' && download.status !== 'error'
  )
  const canCopyLink = Boolean(download.url) && !isLocalMedia
  const canOpenFile = isCompletedStatus && fileExists
  const canDeleteFile = !isLocalMedia && isCompletedStatus && fileExists
  const platformLabel = downloadPlatformDisplayLabel(platform, {
    local: t('download.localSource'),
    other: t('download.otherSource')
  })
  const selectedFormatSize =
    download.selectedFormat?.filesize || download.selectedFormat?.filesize_approx
  const inlineFileSize = selectedFormatSize ? formatFileSize(selectedFormatSize) : undefined
  const displayErrorMessage = getDownloadErrorGuidance(download.error) ?? download.error
  const cookieFailureKind = getCookieSetupFailureKind(download.error)
  const qualityLabel = getQualityLabel(download)
  const liveLog = download.ytDlpLog ?? ''
  const logContent = liveLog.trim().length > 0 ? liveLog : (savedLog ?? '')
  const hasLogContent = logContent.trim().length > 0
  const ytDlpCommand = download.ytDlpCommand?.trim()
  const hasYtDlpCommand = Boolean(ytDlpCommand)
  const canShowSheet = isInProgressStatus || hasLogContent || isTerminalStatus
  const isSelectedHistory = selectionEnabled && isSelected
  useEffect(() => {
    const wasOpen = lastSheetOpenRef.current
    lastSheetOpenRef.current = sheetOpen
    if (!sheetOpen || wasOpen) {
      return
    }
    setLogAutoScroll(true)
  }, [sheetOpen])

  useEffect(() => {
    if (!(sheetOpen && logAutoScroll && logContent)) {
      return
    }
    const container = logContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [logAutoScroll, logContent, sheetOpen])

  // Lazily load the persisted yt-dlp log when opening a terminal item that has
  // no live log (e.g. a failed download reopened from history).
  useEffect(() => {
    if (!(sheetOpen && isTerminalStatus) || liveLog.trim().length > 0 || savedLog !== null) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const item = await ipcServices.history.getHistoryById(download.id)
        if (!cancelled) {
          setSavedLog(item?.ytDlpLog ?? '')
        }
      } catch {
        if (!cancelled) {
          setSavedLog('')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sheetOpen, isTerminalStatus, liveLog, savedLog, download.id])

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
    setLogAutoScroll(true)
    setSheetOpen(true)
  }

  const metaItems: { key: string; node: ReactNode }[] = []
  if (showInlineProgress) {
    metaItems.push({
      key: 'progress',
      node: (
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          {statusIcon}
          {(progressInfo?.percent ?? 0).toFixed(0)}%
        </span>
      )
    })
    if (progressInfo?.currentSpeed) {
      metaItems.push({ key: 'speed', node: progressInfo.currentSpeed })
    }
  } else if (download.status !== 'completed' && statusText) {
    metaItems.push({
      key: 'status',
      node: (
        <span
          className={`inline-flex items-center gap-1 ${
            download.status === 'error' ? 'text-destructive' : ''
          }`}
        >
          {statusIcon}
          {statusText}
        </span>
      )
    })
  }
  if (isNowPlaying) {
    metaItems.push({
      key: 'now-playing',
      node: (
        <span className="inline-flex items-center gap-1 font-medium text-primary">
          <AudioLines className="h-3.5 w-3.5" />
          {t('transcript.player.nowPlaying')}
        </span>
      )
    })
  }
  if (timestamp && !showInlineProgress) {
    metaItems.push({ key: 'date', node: formatDateShort(timestamp) })
  }
  if (qualityLabel && !showInlineProgress) {
    metaItems.push({ key: 'quality', node: qualityLabel })
  }
  if (inlineFileSize && !showInlineProgress) {
    metaItems.push({ key: 'size', node: inlineFileSize })
  }
  if (subtitleRow) {
    metaItems.push({
      key: 'subtitle',
      node: (
        <DownloadMetaTip hint={subtitleRow.hint}>
          <span
            className={`inline-flex items-center gap-1 ${
              subtitleRow.tone === 'danger' ? 'text-destructive' : ''
            }`}
            data-testid="download-subtitle-status"
          >
            {subtitleRow.icon}
            {subtitleRow.label}
          </span>
        </DownloadMetaTip>
      )
    })
  }

  return (
    <ContextMenu onOpenChange={setIsContextMenuOpen}>
      <ContextMenuTrigger asChild>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: composite row with nested controls; click opens transcript */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: nested buttons and checkbox own keyboard focus */}
        <div
          aria-current={isNowPlaying ? 'true' : undefined}
          className={`group relative w-full max-w-full cursor-pointer overflow-hidden px-6 py-2 text-left transition-colors ${
            isSelectedHistory || isContextMenuOpen ? 'bg-primary/10' : ''
          }`}
          data-download-id={download.id}
          data-download-selectable={selectionEnabled ? 'true' : undefined}
          data-now-playing={isNowPlaying ? 'true' : undefined}
          onClick={(event) => {
            if (isListIgnoreTarget(event.target)) {
              return
            }
            handleOpenTranscript()
          }}
        >
          <div className="flex w-full items-start gap-3">
            {/* Thumbnail */}
            <div
              className="pointer-events-none relative z-20 aspect-video h-14 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-background/60"
              ref={coverRef}
            >
              {selectionEnabled && (
                <div
                  className={`pointer-events-auto absolute top-1 left-1 z-30 rounded-md transition ${
                    isSelected || selectionActive
                      ? 'opacity-100'
                      : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
                  }`}
                >
                  <Checkbox
                    aria-label={t('history.selectItem')}
                    checked={Boolean(isSelected)}
                    onCheckedChange={() => onToggleSelect?.(download.id)}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                  />
                </div>
              )}
              <RemoteImage
                alt={download.title}
                className="h-full w-full object-cover"
                fallbackIcon={
                  download.type === 'audio' ? (
                    <FileAudio className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )
                }
                src={download.thumbnail}
              />
              {isNowPlaying ? (
                <span
                  aria-hidden="true"
                  className="transcript-library-now-playing"
                  data-testid="transcript-library-now-playing"
                >
                  <TranscriptAudioEqualizer playing={playbackPlaying} />
                </span>
              ) : null}
            </div>

            {/* Content */}
            <div className="pointer-events-none min-w-0 flex-1 overflow-hidden">
              <div className="flex min-h-14 items-center gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div
                    className={`flex min-w-0 items-center gap-1.5 ${isNowPlaying ? 'text-primary' : ''}`}
                  >
                    <span
                      aria-label={platformLabel}
                      className="inline-flex size-4 shrink-0 items-center justify-center"
                      role="img"
                      title={platformLabel}
                    >
                      <DownloadPlatformIcon
                        className={`block size-4 ${isNowPlaying ? 'text-primary' : ''}`}
                        domain={platform.domain}
                      />
                    </span>
                    <p className="min-w-0 truncate font-medium text-sm">{download.title}</p>
                  </div>
                  <DownloadItemMeta accented={isNowPlaying} items={metaItems} />
                </div>
                <div className="pointer-events-auto relative z-20 flex shrink-0 items-center justify-end gap-0.5 text-muted-foreground">
                  {transcriptListState === 'failed' ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          aria-label={t('transcript.retry')}
                          className="h-8 w-8 shrink-0 rounded-full"
                          onClick={(event) => {
                            event.stopPropagation()
                            void ipcServices.transcript.retry(download.id)
                          }}
                          size="icon"
                          variant="ghost"
                        >
                          <RotateCw className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t('transcript.retry')}</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                  {canRetry ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          aria-label={t('download.retry')}
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
                  ) : null}
                  {canPlayMedia ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          aria-label={t('transcript.player.play')}
                          className="h-8 w-8 shrink-0 rounded-full"
                          onClick={(event) => {
                            event.stopPropagation()
                            handlePlayNow()
                          }}
                          size="icon"
                          variant="ghost"
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t('transcript.player.play')}</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                  <div className={hoverActionsClass}>
                    {!isHistory && isInProgressStatus ? (
                      <>
                        {canPauseDownload && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                aria-label={t('download.pause')}
                                className="h-8 w-8 shrink-0 rounded-full"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void handlePause()
                                }}
                                size="icon"
                                variant="ghost"
                              >
                                <Pause className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{t('download.pause')}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {canResumeDownload && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                aria-label={t('download.resume')}
                                className="h-8 w-8 shrink-0 rounded-full"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void handleResume()
                                }}
                                size="icon"
                                variant="ghost"
                              >
                                <Play className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{t('download.resume')}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <Button
                          aria-label={t('download.cancel')}
                          className="h-8 w-8 shrink-0 rounded-full"
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleCancel()
                          }}
                          size="icon"
                          variant="ghost"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={t('history.moreActions')}
                        className="h-8 w-8 shrink-0 rounded-full"
                        onClick={openContextMenuFromClick}
                        size="icon"
                        variant="ghost"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t('history.moreActions')}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {/* Progress */}
              {download.progress &&
                download.status !== 'completed' &&
                download.status !== 'error' && (
                  <div className="mt-1.5 w-full overflow-hidden rounded-full bg-background/60">
                    <Progress className="h-1 w-full" value={download.progress.percent} />
                  </div>
                )}

              {/* Format-fallback hint: shown on completed rows when yt-dlp's
                  resolved format id does not contain the user-picked id (e.g.
                  user picked Bilibili 4K but only 1080p actually streamed). */}
              {download.status === 'completed' && didFallbackFromPick(download) && (
                <div className="flex flex-col gap-0.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
                  <span className="font-medium text-amber-600 text-xs dark:text-amber-400">
                    {t('download.formatFallbackTitle')}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {t('download.formatFallbackHint', {
                      resolved: download.resolvedFormatId
                    })}
                  </span>
                </div>
              )}

              {/* Error message */}
              {download.status === 'error' && download.error && (
                <div className="flex flex-col gap-1.5">
                  <p className="line-clamp-2 w-full overflow-hidden text-destructive text-xs">
                    {displayErrorMessage}
                  </p>
                  {cookieFailureKind ? (
                    <div className="pointer-events-auto">
                      <Button
                        className="h-7 px-2 text-[11px]"
                        onClick={(event) => {
                          event.stopPropagation()
                          setCookieSetupRequest({
                            downloadId: download.id,
                            failureKind: cookieFailureKind
                          })
                        }}
                        size="sm"
                      >
                        {t('download.cookiesSetupAction')}
                      </Button>
                    </div>
                  ) : null}
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
                      onGlitchTipFeedback={(event) => {
                        event.stopPropagation()
                        return sendGlitchTipFeedback({
                          associatedEventId: download.glitchTipEventId,
                          appInfo,
                          error: download.error,
                          sourceUrl: download.url,
                          ytDlpCommand: download.ytDlpCommand,
                          ytDlpLog: download.ytDlpLog
                        })
                      }}
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

          {canShowSheet && (
            <Sheet onOpenChange={setSheetOpen} open={sheetOpen}>
              <SheetContent
                className="flex h-full min-h-0 w-full flex-col p-0 sm:max-w-lg"
                side="right"
              >
                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                  <SheetHeader className="shrink-0 border-b px-6 pt-6 pb-4">
                    <SheetTitle className="line-clamp-2">{download.title}</SheetTitle>
                    <SheetDescription>{t('download.logsTab')}</SheetDescription>
                  </SheetHeader>
                  <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 py-4">
                    <div className="flex items-center justify-between text-muted-foreground text-xs">
                      <span>
                        {isInProgressStatus ? t('download.logs.live') : t('download.logs.history')}
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
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <DownloadRecordContextMenuItems
          canCopyLink={canCopyLink}
          canCopyToClipboard={canCopyToClipboard()}
          canDeleteFile={canDeleteFile}
          canDeleteRecord={!isInProgressStatus}
          canOpenFile={canOpenFile}
          canPauseDownload={canPauseDownload}
          canResumeDownload={canResumeDownload}
          canRetry={canRetry}
          canShowOpenFolder={showOpenFolderAction}
          isInProgressStatus={isInProgressStatus}
          onAddToPlaylist={handleAddToPlaylist}
          onCancel={() => {
            void handleCancel()
          }}
          onCopyLink={() => {
            void handleCopyLink()
          }}
          onCopyToClipboard={() => {
            void handleCopyToClipboard()
          }}
          onDeleteFile={() => {
            void handleDeleteFile()
          }}
          onDeleteRecord={() => {
            void handleDeleteRecord()
          }}
          onOpenFile={() => {
            void handleOpenFile()
          }}
          onOpenFolder={() => {
            void handleOpenFolder()
          }}
          onPause={() => {
            void handlePause()
          }}
          onResume={() => {
            void handleResume()
          }}
          onRetry={() => {
            void handleRetryDownload()
          }}
          onTranscriptRetry={() => {
            void ipcServices.transcript.retry(download.id)
          }}
          showTranscriptRetry={transcriptListState === 'failed'}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * Hover hint for a compact download-row status fragment.
 *
 * @param children Visible status.
 * @param hint Progress or explanation shown in the tooltip.
 */
function DownloadMetaTip({ children, hint }: { children: ReactNode; hint: string }): ReactNode {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="pointer-events-auto inline-flex h-4 min-w-0 cursor-help items-center">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left" side="bottom" sideOffset={6}>
        <p>{hint}</p>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Hover copy for the compact transcript status on a download row.
 *
 * @param t i18n translate.
 * @param listState Compact transcript status.
 * @param sourceKind Caption vs ASR origin.
 * @param stage Live transcription stage.
 * @param error Failed-task message, if any.
 */
function transcriptRowHint(
  t: (key: string, options?: Record<string, unknown>) => string,
  listState: TranscriptListState,
  sourceKind?: 'asr' | 'captions' | null,
  stage?: string | null,
  error?: string | null
): string {
  switch (listState) {
    case 'queued':
      return t('transcript.listHint.queued')
    case 'retry-scheduled':
      return t('transcript.listHint.retrySoon')
    case 'running':
      return t(transcriptProgressLabelKey('running', stage))
    case 'completed':
      return sourceKind === 'captions'
        ? t('transcript.listHint.captions')
        : t('transcript.listHint.ready')
    case 'no-speech':
      return t('transcript.noSpeechDetail')
    case 'failed':
      return error?.trim() || t('transcript.errorHint')
    case 'cancelled':
      return t('transcript.listHint.cancelled')
    default:
      return t('transcript.view')
  }
}

/**
 * Hover copy for the compact subtitle-download status on a download row.
 *
 * @param t i18n translate.
 * @param status Persisted subtitle outcome.
 * @param languages Downloaded language tags, when present.
 */
function subtitleRowHint(
  t: (key: string, options?: Record<string, unknown>) => string,
  status: 'downloaded' | 'unavailable' | 'skipped-auth' | 'failed',
  languages?: string
): string {
  if (status === 'downloaded') {
    return languages
      ? t('transcript.listHint.subtitlesDownloaded', { languages })
      : t('transcript.listHint.subtitlesDownloadedUnknown')
  }
  if (status === 'unavailable') {
    return t('transcript.listHint.subtitlesUnavailable')
  }
  if (status === 'skipped-auth') {
    return t('transcript.listHint.subtitlesAuth')
  }
  return t('transcript.listHint.subtitlesFailed')
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string

interface DownloadSubtitleRow {
  hint: string
  icon: ReactNode
  label: string
  tone: 'danger' | 'default'
}

/**
 * Build the single subtitles fragment for a download row.
 *
 * Transcription and a downloaded track are both subtitles. Show only the source
 * mark (transcribed, downloaded, queued) beside the captions icon.
 *
 * @param input Row transcript snapshot and subtitle-download outcome.
 */
function resolveDownloadSubtitleRow(input: {
  languages?: string
  sourceKind?: 'asr' | 'captions' | null
  stage?: string | null
  subtitleStatus?: 'downloaded' | 'unavailable' | 'skipped-auth' | 'failed'
  subtitleStatusLabel?: string
  t: TranslateFn
  transcriptError?: string | null
  transcriptListState: TranscriptListState
}): DownloadSubtitleRow | null {
  const {
    languages,
    sourceKind,
    stage,
    subtitleStatus,
    subtitleStatusLabel,
    t,
    transcriptError,
    transcriptListState
  } = input
  const transcribedReady = transcriptListState === 'completed' && sourceKind !== 'captions'
  const downloadedReady =
    subtitleStatus === 'downloaded' ||
    (transcriptListState === 'completed' && sourceKind === 'captions')
  const transcribing =
    transcriptListState === 'queued' ||
    transcriptListState === 'running' ||
    transcriptListState === 'retry-scheduled'
  const join = (...marks: string[]) => marks.join(' · ')

  if (transcribedReady) {
    return {
      hint: transcriptRowHint(t, 'completed', sourceKind, stage, transcriptError),
      icon: transcriptStatusIcon('completed'),
      label: join(t('transcript.listLabel.transcribed')),
      tone: 'default'
    }
  }
  if (transcribing) {
    return {
      hint: transcriptRowHint(t, transcriptListState, sourceKind, stage, transcriptError),
      icon: transcriptStatusIcon(transcriptListState),
      label: join(t(transcriptLibraryStatusKey(transcriptListState, sourceKind))),
      tone: 'default'
    }
  }
  if (downloadedReady) {
    const marks = [t('transcript.listLabel.downloaded')]
    if (languages) {
      marks.push(languages)
    }
    return {
      hint:
        subtitleStatus === 'downloaded'
          ? subtitleRowHint(t, 'downloaded', languages)
          : t('transcript.listHint.captions'),
      icon: <Captions className="h-3.5 w-3.5" />,
      label: join(...marks),
      tone: 'default'
    }
  }
  if (transcriptListState === 'failed' || transcriptListState === 'cancelled') {
    return {
      hint: transcriptRowHint(t, transcriptListState, sourceKind, stage, transcriptError),
      icon: transcriptStatusIcon(transcriptListState),
      label: join(t(transcriptLibraryStatusKey(transcriptListState, sourceKind))),
      tone: transcriptListState === 'failed' ? 'danger' : 'default'
    }
  }
  if (transcriptListState === 'no-speech') {
    return {
      hint: t('transcript.noSpeechDetail'),
      icon: transcriptStatusIcon('no-speech'),
      label: join(t('transcript.noSpeech')),
      tone: 'default'
    }
  }
  if (subtitleStatus && subtitleStatusLabel) {
    return {
      hint: subtitleRowHint(t, subtitleStatus, languages),
      icon: <Captions className="h-3.5 w-3.5" />,
      label: join(subtitleStatusLabel),
      tone: 'default'
    }
  }
  return null
}

/**
 * One metadata line, with dots between the parts that are present.
 *
 * @param accented Use the now-playing primary tone instead of muted gray.
 * @param items Metadata fragments to join.
 */
function DownloadItemMeta({
  accented,
  items
}: {
  accented?: boolean
  items: { key: string; node: ReactNode }[]
}) {
  if (items.length === 0) {
    return null
  }
  return (
    <div
      className={`flex h-4 min-w-0 items-center overflow-hidden text-[12px] leading-none [&_img]:block [&_svg]:block ${
        accented ? 'text-primary' : 'text-muted-foreground'
      }`}
      data-testid="download-item-meta"
    >
      {items.map((item, index) => (
        <span className="inline-flex h-4 min-w-0 items-center" key={item.key}>
          {index > 0 ? (
            <span
              aria-hidden="true"
              className={`mx-1.5 shrink-0 leading-none ${
                accented ? 'text-primary/40' : 'text-muted-foreground/40'
              }`}
            >
              ·
            </span>
          ) : null}
          <span className="inline-flex h-4 min-w-0 items-center truncate">{item.node}</span>
        </span>
      ))}
    </div>
  )
}

/**
 * Compact icon for a transcript's listed status on a download row.
 *
 * @param listState Compact transcript status.
 */
const transcriptStatusIcon = (listState: TranscriptListState): ReactNode => {
  switch (listState) {
    case 'completed':
      return <Captions className="h-3.5 w-3.5" />
    case 'no-speech':
      return <CheckCircle2 className="h-3.5 w-3.5" />
    case 'failed':
      return <AlertCircle className="h-3.5 w-3.5 text-destructive" />
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 animate-spin" />
    case 'queued':
    case 'retry-scheduled':
      return <Loader2 className="h-3.5 w-3.5 animate-spin" />
    case 'cancelled':
      return <X className="h-3.5 w-3.5" />
    default:
      return null
  }
}
