import { AddUrlPopover } from '@renderer/components/ui/add-url-popover'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { DownloadDialogLayout } from '@renderer/components/ui/download-dialog-layout'
import { Label } from '@renderer/components/ui/label'
import type { PlaylistInfo } from '@shared/types'
import {
  buildAudioFormatPreference,
  buildVideoFormatPreference
} from '@shared/utils/format-preferences'
import { buildVideoInfoDownloadMetadata } from '@shared/utils/video-info-metadata'
import {
  ONE_CLICK_CONTAINER_OPTIONS,
  type OneClickContainerOption,
  resolvePlaylistContainerFormat
} from '@vidbee/downloader-core/format-preferences'
import {
  buildSingleVideoFormatSelector,
  isMuxedVideoFormat
} from '@vidbee/downloader-core/format-selector'
import { DownloadContainerSelect } from '@vidbee/ui/components/ui/download-container-select'
import { IngestDropOverlay } from '@vidbee/ui/components/ui/ingest-drop-overlay'
import { WebmThumbnailNotice } from '@vidbee/ui/components/ui/webm-thumbnail-notice'
import { isPlaylistLikeUrl } from '@vidbee/ui/lib/url-kind'
import { useAddUrlInteraction } from '@vidbee/ui/lib/use-add-url-interaction'
import { useHomeIngest } from '@vidbee/ui/lib/use-home-ingest'
import { useAtom, useSetAtom } from 'jotai'
import { FolderOpen, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useImportLocalMedia } from '../../hooks/use-import-local-media'
import { resolveDownloadTargetUrl } from '../../lib/download-url'
import { ipcEvents, ipcServices } from '../../lib/ipc'
import { logger } from '../../lib/logger'
import { addDownloadAtom, removeDownloadAtom } from '../../store/downloads'
import { loadSettingsAtom, saveSettingAtom, settingsAtom } from '../../store/settings'
import {
  clearVideoInfoAtom,
  currentVideoInfoAtom,
  currentVideoInfoSourceUrlAtom,
  fetchVideoInfoAtom,
  videoInfoCommandAtom,
  videoInfoErrorAtom,
  videoInfoLoadingAtom
} from '../../store/video'
import { PlaylistDownload } from './PlaylistDownload'
import { SingleVideoDownload, type SingleVideoState } from './SingleVideoDownload'

interface DownloadDialogProps {
  onOpenSupportedSites?: () => void
  onOpenSettings?: () => void
}

export function DownloadDialog({
  onOpenSupportedSites,
  onOpenSettings: _onOpenSettings
}: DownloadDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [videoInfo, _setVideoInfo] = useAtom(currentVideoInfoAtom)
  const [videoInfoSourceUrl] = useAtom(currentVideoInfoSourceUrlAtom)
  const [videoInfoCommand] = useAtom(videoInfoCommandAtom)
  const [loading] = useAtom(videoInfoLoadingAtom)
  const [error] = useAtom(videoInfoErrorAtom)
  const [settings] = useAtom(settingsAtom)
  const fetchVideoInfo = useSetAtom(fetchVideoInfoAtom)
  const clearVideoInfo = useSetAtom(clearVideoInfoAtom)
  const loadSettings = useSetAtom(loadSettingsAtom)
  const addDownload = useSetAtom(addDownloadAtom)
  const removeDownload = useSetAtom(removeDownloadAtom)
  const saveSetting = useSetAtom(saveSettingAtom)
  const { importMediaPaths, pickAndImportMedia } = useImportLocalMedia()

  const [url, setUrl] = useState('')
  const [activeTab, setActiveTab] = useState<'single' | 'playlist'>('single')

  // Single video state
  const [singleVideoState, setSingleVideoState] = useState<SingleVideoState>({
    title: '',
    activeTab: 'video',
    selectedVideoFormat: '',
    selectedAudioFormat: '',
    customDownloadPath: '',
    startTime: '',
    endTime: '',
    selectedContainer: undefined,
    selectedCodec: undefined,
    selectedFps: undefined
  })

  // Playlist states
  const downloadTypeId = useId()
  const advancedOptionsId = useId()
  const [playlistUrl, setPlaylistUrl] = useState('')
  const [downloadType, setDownloadType] = useState<'video' | 'audio'>('video')
  const [playlistContainer, setPlaylistContainer] = useState<OneClickContainerOption>()
  const [startIndex, setStartIndex] = useState('1')
  const [endIndex, setEndIndex] = useState('')
  const [playlistCustomDownloadPath, setPlaylistCustomDownloadPath] = useState('')
  const [playlistInfo, setPlaylistInfo] = useState<PlaylistInfo | null>(null)
  const [playlistPreviewLoading, setPlaylistPreviewLoading] = useState(false)
  const [playlistDownloadLoading, setPlaylistDownloadLoading] = useState(false)
  const [playlistPreviewError, setPlaylistPreviewError] = useState<string | null>(null)
  const playlistBusy = playlistPreviewLoading || playlistDownloadLoading
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false)
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set())
  const lockDialogHeight = activeTab === 'playlist' && playlistPreviewLoading

  const computePlaylistRange = useCallback(
    (info: PlaylistInfo) => {
      const parsedStart = Math.max(Number.parseInt(startIndex, 10) || 1, 1)
      const rawEnd = endIndex ? Math.max(Number.parseInt(endIndex, 10), parsedStart) : undefined
      const start = info.entryCount > 0 ? Math.min(parsedStart, info.entryCount) : parsedStart
      const endValue =
        rawEnd === undefined
          ? undefined
          : info.entryCount > 0
            ? Math.min(rawEnd, info.entryCount)
            : rawEnd
      return { start, end: endValue }
    },
    [startIndex, endIndex]
  )

  const selectedPlaylistEntries = useMemo(() => {
    if (!playlistInfo) {
      return []
    }
    // If manual selection is active (has selected entries), use that
    if (selectedEntryIds.size > 0) {
      return playlistInfo.entries.filter((entry) => selectedEntryIds.has(entry.id))
    }
    // Otherwise, use range-based selection
    const range = computePlaylistRange(playlistInfo)
    const previewEnd = range.end ?? playlistInfo.entryCount
    return playlistInfo.entries.filter(
      (entry) => entry.index >= range.start && entry.index <= previewEnd
    )
  }, [playlistInfo, computePlaylistRange, selectedEntryIds])

  // Listen for deep link events
  useEffect(() => {
    const handleDeepLink = async (data: unknown) => {
      // Support both old format (string) and new format (object with url and type)
      let url: string
      let type: 'single' | 'playlist' = 'single'

      if (typeof data === 'string') {
        // Legacy format: just URL string
        url = data.trim()
      } else if (data && typeof data === 'object' && 'url' in data) {
        // New format: object with url and type
        url = typeof data.url === 'string' ? data.url.trim() : ''
        if ('type' in data && data.type === 'playlist') {
          type = 'playlist'
        }
      } else {
        return
      }

      if (!url) {
        return
      }

      // Open dialog and set URL
      setOpen(true)
      setActiveTab(type)

      if (type === 'playlist') {
        // Handle playlist
        setPlaylistUrl(url)
        setPlaylistInfo(null)
        setPlaylistPreviewError(null)
        setPlaylistCustomDownloadPath('')
        setSelectedEntryIds(new Set())

        // Wait for dialog to open, then fetch playlist info
        setTimeout(async () => {
          setPlaylistPreviewError(null)
          setPlaylistPreviewLoading(true)
          try {
            const info = await ipcServices.download.getPlaylistInfo(url)
            setPlaylistInfo(info)
            if (info.entryCount === 0) {
              toast.error(t('playlist.noEntries'))
              return
            }
            toast.success(t('playlist.foundVideos', { count: info.entryCount }))
          } catch (error) {
            logger.error('Failed to fetch playlist info:', error)
            const message =
              error instanceof Error && error.message ? error.message : t('playlist.previewFailed')
            setPlaylistPreviewError(message)
            setPlaylistInfo(null)
            toast.error(t('playlist.previewFailed'))
          } finally {
            setPlaylistPreviewLoading(false)
          }
        }, 100)
      } else {
        // Handle single video
        setUrl(url)

        // Wait for dialog to open and settings to load, then fetch video info
        setTimeout(async () => {
          setSingleVideoState((prev) => ({
            ...prev,
            selectedVideoFormat: '',
            selectedAudioFormat: '',
            startTime: '',
            endTime: '',
            selectedContainer: undefined,
            selectedCodec: undefined,
            selectedFps: undefined
          }))
          await fetchVideoInfo(url)
        }, 100)
      }
    }

    ipcEvents.on('download:deeplink', handleDeepLink)
    return () => {
      ipcEvents.removeListener('download:deeplink', handleDeepLink)
    }
  }, [fetchVideoInfo, t])

  useEffect(() => {
    if (!open) {
      return
    }
    loadSettings()
  }, [open, loadSettings])

  /**
   * Queue a one-click download immediately so the row appears before metadata
   * hydration. The facade fills title/thumbnail in the background.
   */
  const startOneClickDownload = useCallback(
    async (targetUrl: string, options?: { clearInput?: boolean; setInputValue?: boolean }) => {
      const trimmedUrl = targetUrl.trim()
      if (!trimmedUrl) {
        toast.error(t('errors.emptyUrl'))
        return
      }

      if (options?.setInputValue) {
        setUrl(trimmedUrl)
      }

      const id = `download_${Date.now()}_${Math.random().toString(36).slice(7)}`
      const format =
        settings.oneClickDownloadType === 'video'
          ? buildVideoFormatPreference(settings)
          : buildAudioFormatPreference(settings)
      const containerFormat =
        settings.oneClickDownloadType === 'video' ? settings.oneClickContainer : undefined

      // Insert the pending row first. Metadata hydration used to run here and
      // kept Bilibili (and similar) URLs out of the list for a long time.
      const downloadItem = {
        id,
        url: trimmedUrl,
        title: t('download.fetchingVideoInfo'),
        type: settings.oneClickDownloadType,
        status: 'pending' as const,
        progress: { percent: 0 },
        createdAt: Date.now()
      }
      addDownload(downloadItem)

      try {
        const started = await ipcServices.download.startDownload(id, {
          url: trimmedUrl,
          type: settings.oneClickDownloadType,
          format,
          containerFormat
        })
        if (!started) {
          removeDownload(id)
          toast.info(t('notifications.downloadAlreadyQueued'))
          return
        }

        toast.success(t('download.oneClickDownloadStarted'))
        if (options?.clearInput) {
          setUrl('')
        }
      } catch (error) {
        removeDownload(id)
        logger.error('Failed to start one-click download:', error)
        toast.error(t('notifications.downloadFailed'))
      }
    },
    [settings, addDownload, removeDownload, t]
  )

  const handleParsePlaylistUrl = useCallback(
    async (trimmedUrl: string) => {
      // #379: drop any stale single-video info when switching to a playlist.
      clearVideoInfo()
      setOpen(true)
      setActiveTab('playlist')
      setPlaylistUrl(trimmedUrl)
      setPlaylistInfo(null)
      setPlaylistPreviewError(null)
      setPlaylistCustomDownloadPath('')
      setSelectedEntryIds(new Set())

      setPlaylistPreviewError(null)
      setPlaylistPreviewLoading(true)
      try {
        const info = await ipcServices.download.getPlaylistInfo(trimmedUrl)
        setPlaylistInfo(info)
        if (info.entryCount === 0) {
          toast.error(t('playlist.noEntries'))
          return
        }
        toast.success(t('playlist.foundVideos', { count: info.entryCount }))
      } catch (error) {
        logger.error('Failed to fetch playlist info:', error)
        const message =
          error instanceof Error && error.message ? error.message : t('playlist.previewFailed')
        setPlaylistPreviewError(message)
        setPlaylistInfo(null)
        toast.error(t('playlist.previewFailed'))
      } finally {
        setPlaylistPreviewLoading(false)
      }
    },
    [clearVideoInfo, t]
  )

  const handleFetchVideo = useCallback(async () => {
    if (!url.trim()) {
      toast.error(t('errors.emptyUrl'))
      return
    }
    if (isPlaylistLikeUrl(url.trim())) {
      // GitHub issue #391: surface the Playlist tab as soon as a playlist URL
      // is detected so the user is not left on the Single Video tab.
      setActiveTab('playlist')
      await handleParsePlaylistUrl(url.trim())
      return
    }
    setSingleVideoState((prev) => ({
      ...prev,
      selectedVideoFormat: '',
      selectedAudioFormat: '',
      startTime: '',
      endTime: '',
      selectedContainer: undefined,
      selectedCodec: undefined,
      selectedFps: undefined
    }))
    await fetchVideoInfo(url.trim())
  }, [url, fetchVideoInfo, handleParsePlaylistUrl, t])

  const handleParseSingleUrl = useCallback(
    async (trimmedUrl: string) => {
      // #379: reset stale info and invalidate in-flight fetches before re-fetch.
      clearVideoInfo()
      setOpen(true)
      setActiveTab('single')
      setUrl(trimmedUrl)
      setSingleVideoState((prev) => ({
        ...prev,
        selectedVideoFormat: '',
        selectedAudioFormat: '',
        startTime: '',
        endTime: '',
        selectedContainer: undefined,
        selectedCodec: undefined,
        selectedFps: undefined
      }))
      await fetchVideoInfo(trimmedUrl)
    },
    [clearVideoInfo, fetchVideoInfo]
  )

  const handleOneClickFromAddUrl = useCallback(
    async (trimmedUrl: string) => {
      await startOneClickDownload(trimmedUrl, { setInputValue: false, clearInput: false })
    },
    [startOneClickDownload]
  )

  const {
    addUrlPopoverOpen,
    addUrlValue,
    batchRequiresOneClick,
    canConfirmAddUrl,
    handleConfirmAddUrl,
    handleOpenAddUrlPopover,
    hasAddUrlValue,
    setAddUrlPopoverOpen,
    setAddUrlValue,
    submitUrl
  } = useAddUrlInteraction({
    activeTab,
    isOneClickDownloadEnabled: settings.oneClickDownload,
    isPlaylistBusy: playlistBusy,
    onEmptyUrl: () => {
      toast.error(t('errors.emptyUrl'))
    },
    onInvalidUrl: () => {
      toast.error(t('errors.invalidUrl'))
    },
    onOneClickDownload: handleOneClickFromAddUrl,
    onParsePlaylist: handleParsePlaylistUrl,
    onParseSingle: handleParseSingleUrl
  })

  /**
   * Send pasted or dropped URLs through the existing download flow.
   */
  const ingestUrls = useCallback(
    async (urls: string[]) => {
      for (const nextUrl of urls) {
        await submitUrl(nextUrl)
      }
    },
    [submitUrl]
  )

  const { dropKind, isDragging } = useHomeIngest({
    enabled: true,
    resolveFilePath: (file) => ipcEvents.getPathForFile(file),
    readClipboardPaths: () => ipcServices.fs.readClipboardFilePaths(),
    onUrls: ingestUrls,
    onMediaPaths: importMediaPaths,
    onUnsupported: () => {
      toast.error(t('notifications.unsupportedDrop'))
    }
  })

  const handleOneClickDownload = useCallback(async () => {
    await startOneClickDownload(url, { clearInput: true })
    setOpen(false) // Close dialog after download starts
  }, [startOneClickDownload, url])

  // Playlist handlers
  const handleSelectPlaylistDirectory = useCallback(async () => {
    if (playlistBusy) {
      return
    }
    try {
      const path = await ipcServices.fs.selectDirectory()
      if (path) {
        setPlaylistCustomDownloadPath(path)
      }
    } catch (error) {
      logger.error('Failed to select directory:', error)
      toast.error(t('settings.directorySelectError'))
    }
  }, [playlistBusy, t])

  const handlePreviewPlaylist = useCallback(async () => {
    if (!playlistUrl.trim()) {
      toast.error(t('errors.emptyUrl'))
      return
    }
    setPlaylistPreviewError(null)
    setPlaylistPreviewLoading(true)
    try {
      const trimmedUrl = playlistUrl.trim()
      const info = await ipcServices.download.getPlaylistInfo(trimmedUrl)
      setPlaylistInfo(info)
      setSelectedEntryIds(new Set())
      if (info.entryCount === 0) {
        toast.error(t('playlist.noEntries'))
        return
      }
      toast.success(t('playlist.foundVideos', { count: info.entryCount }))
    } catch (error) {
      logger.error('Failed to fetch playlist info:', error)
      const message =
        error instanceof Error && error.message ? error.message : t('playlist.previewFailed')
      setPlaylistPreviewError(message)
      setPlaylistInfo(null)
      toast.error(t('playlist.previewFailed'))
    } finally {
      setPlaylistPreviewLoading(false)
    }
  }, [playlistUrl, t])

  const handleDownloadPlaylist = useCallback(async () => {
    const trimmedUrl = playlistUrl.trim()
    if (!trimmedUrl) {
      toast.error(t('errors.emptyUrl'))
      return
    }

    if (!playlistInfo) {
      toast.error(t('playlist.previewRequired'))
      return
    }

    setPlaylistPreviewError(null)
    setPlaylistDownloadLoading(true)
    try {
      const info = playlistInfo
      setPlaylistInfo(info)

      if (info.entryCount === 0) {
        toast.error(t('playlist.noEntries'))
        return
      }

      // Use manual selection if available, otherwise use range
      let startIndex: number | undefined
      let endIndex: number | undefined
      let entryIds: string[] | undefined

      if (selectedEntryIds.size > 0) {
        const selectedEntries = info.entries
          .filter((entry) => selectedEntryIds.has(entry.id))
          .sort((a, b) => a.index - b.index)
        const selectedIndices = selectedEntries.map((entry) => entry.index).sort((a, b) => a - b)

        if (selectedEntries.length === 0) {
          toast.error(t('playlist.noEntriesSelected'))
          return
        }

        entryIds = selectedEntries.map((entry) => entry.id)
        startIndex = selectedIndices[0]
        endIndex = selectedIndices.at(-1)
      } else {
        // Range-based selection
        const range = computePlaylistRange(info)
        const previewEnd = range.end ?? info.entryCount

        if (previewEnd < range.start || previewEnd === 0) {
          toast.error(t('playlist.noEntriesInRange'))
          return
        }

        startIndex = range.start
        endIndex = range.end
      }

      const format =
        downloadType === 'video'
          ? buildVideoFormatPreference(settings)
          : buildAudioFormatPreference(settings)
      const containerFormat = resolvePlaylistContainerFormat(
        downloadType,
        playlistContainer,
        settings.oneClickContainer
      )

      const result = await ipcServices.download.startPlaylistDownload({
        url: trimmedUrl,
        type: downloadType,
        format,
        startIndex,
        endIndex,
        entryIds,
        customDownloadPath: playlistCustomDownloadPath.trim() || undefined,
        containerFormat
      })

      if (result.totalCount === 0) {
        toast.error(t('playlist.noEntriesInRange'))
        return
      }

      const baseCreatedAt = Date.now()
      result.entries.forEach((entry, index) => {
        const downloadItem = {
          id: entry.downloadId,
          url: entry.url,
          title: entry.title || t('download.fetchingVideoInfo'),
          type: downloadType,
          status: 'pending' as const,
          progress: { percent: 0 },
          createdAt: baseCreatedAt + index,
          playlistId: result.groupId,
          playlistTitle: result.playlistTitle,
          playlistIndex: entry.index,
          playlistSize: result.totalCount
        }
        addDownload(downloadItem)
      })

      setOpen(false) // Close dialog after download starts
    } catch (error) {
      logger.error('Failed to start playlist download:', error)
      toast.error(t('playlist.downloadFailed'))
    } finally {
      setPlaylistDownloadLoading(false)
    }
  }, [
    playlistUrl,
    playlistInfo,
    computePlaylistRange,
    downloadType,
    settings,
    addDownload,
    t,
    playlistCustomDownloadPath,
    playlistContainer,
    selectedEntryIds
  ])

  // Update single video title when videoInfo changes
  useEffect(() => {
    if (videoInfo) {
      setSingleVideoState((prev) => ({
        ...prev,
        title: videoInfo.title || prev.title
      }))
    }
  }, [videoInfo])

  const handleSingleVideoDownload = useCallback(async () => {
    if (!videoInfo) {
      return
    }
    // GitHub issue #379: the displayed info may belong to a previously fetched
    // URL; refuse to download when it no longer matches the current input so we
    // never download the wrong (stale) video.
    if (videoInfoSourceUrl !== url.trim()) {
      toast.error(t('errors.fetchInfoFailed'))
      return
    }

    const downloadTargetUrl = resolveDownloadTargetUrl({
      fallbackUrl: url,
      webpageUrl: videoInfo.webpage_url
    })
    if (!downloadTargetUrl) {
      toast.error(t('errors.invalidUrl'))
      return
    }

    const type = singleVideoState.activeTab
    const selectedFormat =
      type === 'video' ? singleVideoState.selectedVideoFormat : singleVideoState.selectedAudioFormat
    if (!selectedFormat) {
      return
    }
    const id = `download_${Date.now()}_${Math.random().toString(36).slice(7)}`

    const selectedVideoFormat =
      type === 'video'
        ? (videoInfo.formats || []).find((format) => format.format_id === selectedFormat)
        : undefined
    const selectedAudioFormat =
      type === 'audio'
        ? (videoInfo.formats || []).find((format) => format.format_id === selectedFormat)
        : undefined
    const selectedDownloadFormat = selectedVideoFormat ?? selectedAudioFormat
    const metadata = buildVideoInfoDownloadMetadata(videoInfo)
    const downloadItem = {
      id,
      url: downloadTargetUrl,
      title: singleVideoState.title || metadata.title || t('download.fetchingVideoInfo'),
      thumbnail: metadata.thumbnail,
      type,
      status: 'pending' as const,
      progress: { percent: 0 },
      duration: metadata.duration,
      description: metadata.description,
      channel: metadata.channel,
      uploader: metadata.uploader,
      viewCount: metadata.viewCount,
      selectedFormat: selectedDownloadFormat,
      createdAt: Date.now()
    }
    const resolvedFormat =
      type === 'video'
        ? buildSingleVideoFormatSelector(selectedFormat, selectedVideoFormat)
        : selectedFormat

    const options = {
      url: downloadTargetUrl,
      type,
      format: resolvedFormat || undefined,
      audioFormat: type === 'video' && isMuxedVideoFormat(selectedVideoFormat) ? '' : undefined,
      startTime: singleVideoState.startTime.trim() || undefined,
      endTime: singleVideoState.endTime.trim() || undefined,
      customDownloadPath: singleVideoState.customDownloadPath.trim() || undefined,
      // Pass renderer-fetched videoInfo through so the kernel's projection
      // round-trips it back instead of clobbering the optimistic row.
      ...metadata,
      title: singleVideoState.title || metadata.title,
      selectedFormat: selectedDownloadFormat
    }

    try {
      const started = await ipcServices.download.startDownload(id, options)
      if (!started) {
        toast.info(t('notifications.downloadAlreadyQueued'))
        return
      }
      addDownload(downloadItem)

      setOpen(false) // Close dialog after download starts
    } catch (error) {
      logger.error('Failed to start download:', error)
      toast.error(t('notifications.downloadFailed'))
    }
  }, [videoInfo, videoInfoSourceUrl, singleVideoState, addDownload, t, url])

  const wasDialogOpenRef = useRef(open)

  // Reset form only when the dialog actually closes. `if (!open)` also ran
  // on the closed idle state and invalidated in-flight fetches started in
  // the same click as setOpen(true).
  useEffect(() => {
    const wasOpen = wasDialogOpenRef.current
    wasDialogOpenRef.current = open
    if (!(wasOpen && !open)) {
      return
    }

    clearVideoInfo()
    setUrl('')
    setActiveTab('single')
    setSingleVideoState({
      title: '',
      activeTab: 'video',
      selectedVideoFormat: '',
      selectedAudioFormat: '',
      customDownloadPath: '',
      startTime: '',
      endTime: '',
      selectedContainer: undefined,
      selectedCodec: undefined,
      selectedFps: undefined
    })

    setPlaylistUrl('')
    setPlaylistContainer(undefined)
    setPlaylistInfo(null)
    setPlaylistPreviewError(null)
    setPlaylistCustomDownloadPath('')
    setStartIndex('1')
    setEndIndex('')
    setSelectedEntryIds(new Set())
  }, [open, clearVideoInfo])

  const handleSingleVideoStateChange = useCallback(
    (updates: Partial<SingleVideoState>) => {
      setSingleVideoState((prev) => ({ ...prev, ...updates }))

      if (
        !(settings.rememberLastAudioLanguage && updates.selectedAudioFormat && videoInfo?.formats)
      ) {
        return
      }

      const selectedAudioFormat = videoInfo.formats.find(
        (format) => format.format_id === updates.selectedAudioFormat
      )
      const preferredAudioLanguage = selectedAudioFormat?.language?.trim()
      if (!(preferredAudioLanguage && preferredAudioLanguage !== settings.preferredAudioLanguage)) {
        return
      }

      void saveSetting({ key: 'preferredAudioLanguage', value: preferredAudioLanguage })
    },
    [
      saveSetting,
      settings.preferredAudioLanguage,
      settings.rememberLastAudioLanguage,
      videoInfo?.formats
    ]
  )
  const selectedSingleFormat =
    singleVideoState.activeTab === 'video'
      ? singleVideoState.selectedVideoFormat
      : singleVideoState.selectedAudioFormat

  return (
    <>
      <DownloadDialogLayout
        activeTab={activeTab}
        addUrlPopover={
          <AddUrlPopover
            addLocalMediaLabel={t('transcript.library.addMedia')}
            cancelLabel={t('download.cancel')}
            confirmDisabled={!canConfirmAddUrl}
            confirmLabel={t('download.fetch')}
            description={t('download.enterUrlDescription')}
            invalidMessage={
              batchRequiresOneClick
                ? t('errors.batchRequiresOneClick')
                : hasAddUrlValue && !canConfirmAddUrl
                  ? t('errors.invalidUrl')
                  : undefined
            }
            moreActionsLabel={t('download.moreAddActions')}
            onAddLocalMedia={() => {
              void pickAndImportMedia()
            }}
            onCancel={() => {
              setAddUrlPopoverOpen(false)
            }}
            onConfirm={() => {
              void handleConfirmAddUrl()
            }}
            oneClickDownloadDescription={t('download.oneClickDownloadTooltip')}
            oneClickDownloadEnabled={settings.oneClickDownload}
            oneClickDownloadLabel={t('download.oneClickDownload')}
            onOpenChange={setAddUrlPopoverOpen}
            onOpenSupportedSites={onOpenSupportedSites}
            onToggleOneClickDownload={() => {
              saveSetting({ key: 'oneClickDownload', value: !settings.oneClickDownload })
            }}
            onTriggerClick={() => {
              void handleOpenAddUrlPopover()
            }}
            onValueChange={setAddUrlValue}
            open={addUrlPopoverOpen}
            placeholder={t('download.urlPlaceholder')}
            supportedSitesLabel={t('menu.supportedSites')}
            title={t('download.enterUrl')}
            triggerLabel={t('download.pasteUrlButton')}
            value={addUrlValue}
          />
        }
        dialogSubtitle={t('download.dialogSubtitle')}
        dialogTitle={t('download.dialogTitle')}
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {/* Download Location - Single Video */}
              {activeTab === 'single' && videoInfo && !loading && (
                <div className="flex min-w-0 items-center gap-2">
                  <Button
                    className="h-9 max-w-[240px] justify-start gap-2 px-0 font-normal text-muted-foreground text-sm hover:bg-transparent hover:text-foreground"
                    onClick={async () => {
                      try {
                        const path = await ipcServices.fs.selectDirectory()
                        if (path) {
                          setSingleVideoState((prev) => ({
                            ...prev,
                            customDownloadPath: path
                          }))
                        }
                      } catch (error) {
                        logger.error('Failed to select directory:', error)
                        toast.error(t('settings.directorySelectError'))
                      }
                    }}
                    title={singleVideoState.customDownloadPath || settings.downloadPath}
                    variant="ghost"
                  >
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {singleVideoState.customDownloadPath ||
                        settings.downloadPath ||
                        t('download.autoFolderPlaceholder')}
                    </span>
                  </Button>

                  {singleVideoState.customDownloadPath && (
                    <Button
                      className="h-8 shrink-0 text-xs"
                      onClick={() =>
                        setSingleVideoState((prev) => ({
                          ...prev,
                          customDownloadPath: ''
                        }))
                      }
                      size="sm"
                      variant="ghost"
                    >
                      {t('download.useAutoFolder')}
                    </Button>
                  )}
                </div>
              )}

              {activeTab === 'playlist' && playlistInfo && !playlistPreviewLoading && (
                <div className="flex min-w-0 items-center gap-2">
                  <Button
                    className="h-9 min-w-0 max-w-[220px] justify-start gap-2 px-0 font-normal text-muted-foreground text-sm hover:bg-transparent hover:text-foreground"
                    disabled={playlistBusy}
                    onClick={() => {
                      void handleSelectPlaylistDirectory()
                    }}
                    title={playlistCustomDownloadPath || settings.downloadPath}
                    variant="ghost"
                  >
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {playlistCustomDownloadPath ||
                        settings.downloadPath ||
                        t('download.autoFolderPlaceholder')}
                    </span>
                  </Button>
                  {playlistCustomDownloadPath && (
                    <Button
                      className="h-8 shrink-0 text-xs"
                      disabled={playlistBusy}
                      onClick={() => setPlaylistCustomDownloadPath('')}
                      size="sm"
                      variant="ghost"
                    >
                      {t('download.useAutoFolder')}
                    </Button>
                  )}
                </div>
              )}

              {/* Advanced Options - Playlist (when no playlist info) */}
              {activeTab === 'playlist' && !playlistInfo && !playlistPreviewLoading && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={advancedOptionsOpen}
                    id={advancedOptionsId}
                    onCheckedChange={(checked) => {
                      setAdvancedOptionsOpen(checked === true)
                    }}
                  />
                  <Label className="cursor-pointer text-xs" htmlFor={advancedOptionsId}>
                    {t('advancedOptions.title')}
                  </Label>
                </div>
              )}
            </div>
            <div className="ml-auto flex gap-2">
              {activeTab === 'single' ? (
                videoInfo || loading ? (
                  !loading && videoInfo ? (
                    <Button
                      disabled={loading || !selectedSingleFormat}
                      onClick={handleSingleVideoDownload}
                    >
                      {singleVideoState.activeTab === 'video'
                        ? t('download.downloadVideo')
                        : t('download.downloadAudio')}
                    </Button>
                  ) : null
                ) : (
                  <Button
                    disabled={loading || !url.trim()}
                    onClick={settings.oneClickDownload ? handleOneClickDownload : handleFetchVideo}
                  >
                    {settings.oneClickDownload
                      ? t('download.oneClickDownloadNow')
                      : t('download.startDownload')}
                  </Button>
                )
              ) : playlistInfo && !playlistPreviewLoading ? (
                <Button
                  className="shrink-0 whitespace-nowrap"
                  disabled={playlistDownloadLoading || selectedPlaylistEntries.length === 0}
                  onClick={handleDownloadPlaylist}
                >
                  {playlistDownloadLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    t('playlist.downloadCurrentRange')
                  )}
                </Button>
              ) : playlistPreviewLoading ? null : (
                <Button
                  disabled={playlistBusy || !playlistUrl.trim()}
                  onClick={handlePreviewPlaylist}
                >
                  {playlistPreviewLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    t('download.startDownload')
                  )}
                </Button>
              )}
            </div>
          </div>
        }
        lockDialogHeight={lockDialogHeight}
        onActiveTabChange={setActiveTab}
        onOpenChange={setOpen}
        open={open}
        playlistTabContent={
          <PlaylistDownload
            advancedOptionsOpen={advancedOptionsOpen}
            containerSelect={
              downloadType === 'video' && (
                <>
                  <DownloadContainerSelect
                    disabled={playlistBusy}
                    onValueChange={setPlaylistContainer}
                    options={ONE_CLICK_CONTAINER_OPTIONS}
                    value={playlistContainer ?? settings.oneClickContainer ?? 'auto'}
                  />
                  <WebmThumbnailNotice
                    className="w-full"
                    container={resolvePlaylistContainerFormat(
                      downloadType,
                      playlistContainer,
                      settings.oneClickContainer
                    )}
                  />
                </>
              )
            }
            downloadType={downloadType}
            downloadTypeId={downloadTypeId}
            endIndex={endIndex}
            onAdvancedOpenChange={setAdvancedOptionsOpen}
            playlistBusy={playlistBusy}
            playlistInfo={playlistInfo}
            playlistPreviewError={playlistPreviewError}
            playlistPreviewLoading={playlistPreviewLoading}
            selectedEntryIds={selectedEntryIds}
            selectedPlaylistEntries={selectedPlaylistEntries}
            setDownloadType={setDownloadType}
            setEndIndex={setEndIndex}
            setSelectedEntryIds={setSelectedEntryIds}
            setStartIndex={setStartIndex}
            startIndex={startIndex}
          />
        }
        playlistTabLabel={t('download.metadata.playlist')}
        singleTabContent={
          <SingleVideoDownload
            error={error}
            feedbackSourceUrl={url}
            loading={loading}
            onStateChange={handleSingleVideoStateChange}
            state={singleVideoState}
            videoInfo={videoInfo}
            ytDlpCommand={videoInfoCommand ?? undefined}
          />
        }
        singleTabLabel={t('download.singleVideo')}
      />
      <IngestDropOverlay
        description={t('download.ingestDropDescription')}
        kind={dropKind}
        mediaTitle={t('download.ingestDropMedia')}
        mixedTitle={t('download.ingestDropMixed')}
        urlTitle={t('download.ingestDropUrl')}
        visible={isDragging}
      />
    </>
  )
}
