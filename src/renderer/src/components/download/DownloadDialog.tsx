import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { cn } from '@renderer/lib/utils'
import type { PlaylistInfo, VideoFormat } from '@shared/types'
import {
  buildAudioFormatPreference,
  buildVideoFormatPreference
} from '@shared/utils/format-preferences'
import { useAtom, useSetAtom } from 'jotai'
import { FolderOpen, List, Loader2, Plus, Video } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcEvents, ipcServices } from '../../lib/ipc'
import { addDownloadAtom } from '../../store/downloads'
import { loadSettingsAtom, settingsAtom } from '../../store/settings'
import {
  currentVideoInfoAtom,
  fetchVideoInfoAtom,
  videoInfoCommandAtom,
  videoInfoErrorAtom,
  videoInfoLoadingAtom
} from '../../store/video'
import { PlaylistDownload } from './PlaylistDownload'
import { SingleVideoDownload, type SingleVideoState } from './SingleVideoDownload'

const isLikelyUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const isAudioOnlyFormat = (format: VideoFormat): boolean =>
  !!format.acodec && format.acodec !== 'none' && (!format.video_ext || format.video_ext === 'none')

const isHlsFormat = (format: VideoFormat): boolean =>
  format.protocol === 'm3u8' || format.protocol === 'm3u8_native'

const sortAudioFormatsByQuality = (a: VideoFormat, b: VideoFormat): number => {
  const aQuality = a.tbr ?? a.quality ?? 0
  const bQuality = b.tbr ?? b.quality ?? 0
  if (aQuality !== bQuality) {
    return bQuality - aQuality
  }
  const aHasSize = !!(a.filesize || a.filesize_approx)
  const bHasSize = !!(b.filesize || b.filesize_approx)
  if (aHasSize !== bHasSize) {
    return bHasSize ? 1 : -1
  }
  return 0
}

const pickBestAudioFormatsByLanguage = (formats: VideoFormat[]): string[] => {
  const audioFormats = formats.filter(isAudioOnlyFormat)
  if (audioFormats.length === 0) {
    return []
  }

  const nonHls = audioFormats.filter((format) => !isHlsFormat(format))
  const candidates = nonHls.length > 0 ? nonHls : audioFormats

  const grouped = new Map<string, VideoFormat[]>()
  for (const format of candidates) {
    const language = format.language?.trim() || 'und'
    const existing = grouped.get(language)
    if (existing) {
      existing.push(format)
    } else {
      grouped.set(language, [format])
    }
  }

  const sortedLanguages = Array.from(grouped.entries()).sort(([a], [b]) => {
    if (a === 'und') {
      return 1
    }
    if (b === 'und') {
      return -1
    }
    return a.localeCompare(b)
  })

  return sortedLanguages
    .map(([, languageFormats]) => {
      const sorted = [...languageFormats].sort(sortAudioFormatsByQuality)
      return sorted[0]?.format_id
    })
    .filter((id): id is string => !!id)
}

interface DownloadDialogProps {
  onOpenSupportedSites?: () => void
  onOpenSettings?: () => void
}

export function DownloadDialog({
  onOpenSupportedSites: _onOpenSupportedSites,
  onOpenSettings: _onOpenSettings
}: DownloadDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [videoInfo, _setVideoInfo] = useAtom(currentVideoInfoAtom)
  const [videoInfoCommand] = useAtom(videoInfoCommandAtom)
  const [loading] = useAtom(videoInfoLoadingAtom)
  const [error] = useAtom(videoInfoErrorAtom)
  const [settings] = useAtom(settingsAtom)
  const fetchVideoInfo = useSetAtom(fetchVideoInfoAtom)
  const loadSettings = useSetAtom(loadSettingsAtom)
  const addDownload = useSetAtom(addDownloadAtom)

  const [url, setUrl] = useState('')
  const [activeTab, setActiveTab] = useState<'single' | 'playlist'>('single')

  // Single video state
  const [singleVideoState, setSingleVideoState] = useState<SingleVideoState>({
    title: '',
    activeTab: 'video',
    selectedVideoFormat: '',
    selectedAudioFormat: '',
    customDownloadPath: '',
    selectedContainer: undefined,
    selectedCodec: undefined,
    selectedFps: undefined
  })

  // Playlist states
  const downloadTypeId = useId()
  const advancedOptionsId = useId()
  const [playlistUrl, setPlaylistUrl] = useState('')
  const [downloadType, setDownloadType] = useState<'video' | 'audio'>('video')
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
  const lockDialogHeight =
    activeTab === 'playlist' && (playlistPreviewLoading || playlistInfo !== null)

  const computePlaylistRange = useCallback(
    (info: PlaylistInfo) => {
      const parsedStart = Math.max(Number.parseInt(startIndex, 10) || 1, 1)
      const rawEnd = endIndex ? Math.max(Number.parseInt(endIndex, 10), parsedStart) : undefined
      const start = info.entryCount > 0 ? Math.min(parsedStart, info.entryCount) : parsedStart
      const endValue =
        rawEnd !== undefined
          ? info.entryCount > 0
            ? Math.min(rawEnd, info.entryCount)
            : rawEnd
          : undefined
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
            console.error('Failed to fetch playlist info:', error)
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

      const id = `download_${Date.now()}_${Math.random().toString(36).substring(7)}`

      const downloadItem = {
        id,
        url: trimmedUrl,
        title: t('download.fetchingVideoInfo'),
        type: settings.oneClickDownloadType,
        status: 'pending' as const,
        progress: { percent: 0 },
        createdAt: Date.now()
      }

      const format =
        settings.oneClickDownloadType === 'video'
          ? buildVideoFormatPreference(settings)
          : buildAudioFormatPreference(settings)

      try {
        const started = await ipcServices.download.startDownload(id, {
          url: trimmedUrl,
          type: settings.oneClickDownloadType,
          format
        })
        if (!started) {
          toast.info(t('notifications.downloadAlreadyQueued'))
          return
        }
        addDownload(downloadItem)

        toast.success(t('download.oneClickDownloadStarted'))
        if (options?.clearInput) {
          setUrl('')
        }
      } catch (error) {
        console.error('Failed to start one-click download:', error)
        toast.error(t('notifications.downloadFailed'))
      }
    },
    [settings, addDownload, t]
  )

  const handleFetchVideo = useCallback(async () => {
    if (!url.trim()) {
      toast.error(t('errors.emptyUrl'))
      return
    }
    setSingleVideoState((prev) => ({
      ...prev,
      selectedVideoFormat: '',
      selectedAudioFormat: '',
      selectedContainer: undefined,
      selectedCodec: undefined,
      selectedFps: undefined
    }))
    await fetchVideoInfo(url.trim())
  }, [url, fetchVideoInfo, t])

  const handleAutoDetectClipboard = useCallback(async () => {
    if (!navigator.clipboard?.readText) {
      return
    }

    let text = ''
    try {
      text = await navigator.clipboard.readText()
    } catch {
      return
    }

    const trimmedUrl = text.trim()
    if (!trimmedUrl) {
      return
    }
    if (!isLikelyUrl(trimmedUrl)) {
      toast.error(t('errors.invalidUrl'))
      return
    }

    if (activeTab === 'playlist') {
      if (playlistBusy || playlistUrl.trim()) {
        return
      }

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
        console.error('Failed to fetch playlist info:', error)
        const message =
          error instanceof Error && error.message ? error.message : t('playlist.previewFailed')
        setPlaylistPreviewError(message)
        setPlaylistInfo(null)
        toast.error(t('playlist.previewFailed'))
      } finally {
        setPlaylistPreviewLoading(false)
      }
      return
    }

    if (loading || url.trim()) {
      return
    }

    setUrl(trimmedUrl)

    if (settings.oneClickDownload) {
      await startOneClickDownload(trimmedUrl, { setInputValue: false, clearInput: false })
      setOpen(false)
      return
    }

    await fetchVideoInfo(trimmedUrl)
  }, [
    activeTab,
    fetchVideoInfo,
    loading,
    playlistBusy,
    playlistUrl,
    settings.oneClickDownload,
    startOneClickDownload,
    t,
    url
  ])

  const handleOpenDialog = useCallback(async () => {
    if (settings.oneClickDownload) {
      if (!navigator.clipboard?.readText) {
        toast.error(t('errors.pasteFromClipboard'))
        return
      }

      let text = ''
      try {
        text = await navigator.clipboard.readText()
      } catch {
        toast.error(t('errors.pasteFromClipboard'))
        return
      }

      const trimmedUrl = text.trim()
      if (!trimmedUrl) {
        toast.error(t('errors.clipboardEmpty'))
        return
      }

      if (!isLikelyUrl(trimmedUrl)) {
        toast.error(t('errors.invalidUrl'))
        return
      }

      await startOneClickDownload(trimmedUrl, { setInputValue: false, clearInput: false })
      return
    }

    // Check clipboard before opening dialog
    if (!navigator.clipboard?.readText) {
      setOpen(true)
      return
    }

    let text = ''
    try {
      text = await navigator.clipboard.readText()
    } catch {
      setOpen(true)
      return
    }

    const trimmedUrl = text.trim()
    if (!trimmedUrl) {
      setOpen(true)
      return
    }

    if (!isLikelyUrl(trimmedUrl)) {
      toast.error(t('errors.invalidUrl'))
      return
    }

    // If it's a valid URL, open dialog and let handleAutoDetectClipboard process it
    setOpen(true)
  }, [settings.oneClickDownload, startOneClickDownload, t])

  useEffect(() => {
    if (!open) {
      return
    }
    void handleAutoDetectClipboard()
  }, [open, handleAutoDetectClipboard])

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
      console.error('Failed to select directory:', error)
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
      console.error('Failed to fetch playlist info:', error)
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

      if (selectedEntryIds.size > 0) {
        // Manual selection mode: find min and max indices
        const selectedIndices = Array.from(selectedEntryIds)
          .map((id) => info.entries.find((e) => e.id === id)?.index)
          .filter((idx): idx is number => idx !== undefined)
          .sort((a, b) => a - b)

        if (selectedIndices.length === 0) {
          toast.error(t('playlist.noEntriesSelected'))
          return
        }

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

      const result = await ipcServices.download.startPlaylistDownload({
        url: trimmedUrl,
        type: downloadType,
        format,
        startIndex,
        endIndex,
        customDownloadPath: playlistCustomDownloadPath.trim() || undefined
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
      console.error('Failed to start playlist download:', error)
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

    const type = singleVideoState.activeTab
    const selectedFormat =
      type === 'video' ? singleVideoState.selectedVideoFormat : singleVideoState.selectedAudioFormat
    if (!selectedFormat) {
      return
    }
    const id = `download_${Date.now()}_${Math.random().toString(36).substring(7)}`

    const downloadItem = {
      id,
      url: videoInfo.webpage_url || '',
      title: singleVideoState.title || videoInfo.title || t('download.fetchingVideoInfo'),
      thumbnail: videoInfo.thumbnail,
      type,
      status: 'pending' as const,
      progress: { percent: 0 },
      duration: videoInfo.duration,
      description: videoInfo.description,
      channel: videoInfo.extractor_key,
      uploader: videoInfo.extractor_key,
      createdAt: Date.now()
    }

    const audioFormatIds =
      type === 'video' ? pickBestAudioFormatsByLanguage(videoInfo.formats || []) : undefined

    const options = {
      url: videoInfo.webpage_url || '',
      type,
      format: selectedFormat || undefined,
      audioFormat: type === 'video' ? 'best' : undefined,
      audioFormatIds: audioFormatIds && audioFormatIds.length > 0 ? audioFormatIds : undefined,
      customDownloadPath: singleVideoState.customDownloadPath.trim() || undefined
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
      console.error('Failed to start download:', error)
      toast.error(t('notifications.downloadFailed'))
    }
  }, [videoInfo, singleVideoState, addDownload, t])

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      // Reset single video states
      setUrl('')
      setActiveTab('single')
      setSingleVideoState({
        title: '',
        activeTab: 'video',
        selectedVideoFormat: '',
        selectedAudioFormat: '',
        customDownloadPath: '',
        selectedContainer: undefined,
        selectedCodec: undefined,
        selectedFps: undefined
      })

      // Reset playlist states
      setPlaylistUrl('')
      setPlaylistInfo(null)
      setPlaylistPreviewError(null)
      setPlaylistCustomDownloadPath('')
      setStartIndex('1')
      setEndIndex('')
      setSelectedEntryIds(new Set())
    }
  }, [open])

  const handleSingleVideoStateChange = useCallback((updates: Partial<SingleVideoState>) => {
    setSingleVideoState((prev) => ({ ...prev, ...updates }))
  }, [])
  const selectedSingleFormat =
    singleVideoState.activeTab === 'video'
      ? singleVideoState.selectedVideoFormat
      : singleVideoState.selectedAudioFormat

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <Button
        className="rounded-full"
        onClick={() => {
          void handleOpenDialog()
        }}
      >
        <Plus className="h-4 w-4" />
        {t('download.pasteUrlButton')}
      </Button>
      <DialogContent
        className={cn(
          'flex max-h-[90vh] flex-col gap-0 overflow-hidden p-5 sm:max-w-xl',
          lockDialogHeight && 'h-[90vh]'
        )}
      >
        <Tabs
          className="flex min-h-0 w-full flex-1 flex-col gap-0"
          defaultValue="single"
          onValueChange={(value) => setActiveTab(value as 'single' | 'playlist')}
          value={activeTab}
        >
          <DialogHeader>
            <TabsList>
              <TabsTrigger onClick={() => setActiveTab('single')} value="single">
                <Video className="h-3.5 w-3.5" />
                {t('download.singleVideo')}
              </TabsTrigger>
              <TabsTrigger onClick={() => setActiveTab('playlist')} value="playlist">
                <List className="h-3.5 w-3.5" />
                {t('download.metadata.playlist')}
              </TabsTrigger>
            </TabsList>
          </DialogHeader>
          {/* Single Video Download Tab */}
          <TabsContent className="mt-0 flex min-h-0 flex-1 flex-col" value="single">
            <SingleVideoDownload
              error={error}
              feedbackSourceUrl={url}
              loading={loading}
              onStateChange={handleSingleVideoStateChange}
              state={singleVideoState}
              videoInfo={videoInfo}
              ytDlpCommand={videoInfoCommand ?? undefined}
            />
          </TabsContent>

          {/* Playlist Download Tab */}
          <TabsContent className="mt-0 flex min-h-0 flex-1 flex-col" value="playlist">
            <PlaylistDownload
              advancedOptionsOpen={advancedOptionsOpen}
              downloadType={downloadType}
              downloadTypeId={downloadTypeId}
              endIndex={endIndex}
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
          </TabsContent>
        </Tabs>
        <DialogFooter className="relative z-10 shrink-0 border-t bg-background pt-3">
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {/* Download Location - Single Video */}
              {activeTab === 'single' && videoInfo && !loading && (
                <div className="flex items-center gap-2">
                  <div className="relative w-[240px]">
                    <Input
                      className="pr-7"
                      placeholder={t('download.autoFolderPlaceholder')}
                      readOnly
                      value={singleVideoState.customDownloadPath || settings.downloadPath}
                    />
                    <div className="absolute top-1/2 right-0 -translate-y-1/2">
                      <Button
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
                            console.error('Failed to select directory:', error)
                            toast.error(t('settings.directorySelectError'))
                          }
                        }}
                        size="icon"
                        variant="ghost"
                      >
                        <FolderOpen className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>

                  {singleVideoState.customDownloadPath && (
                    <Button
                      className="h-8 text-xs"
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

              {/* Download Location - Playlist */}
              {activeTab === 'playlist' && playlistInfo && !playlistPreviewLoading && (
                <div className="flex items-center gap-2">
                  <div className="relative w-[200px]">
                    <Input
                      className="h-8 bg-muted/30 pr-7 text-xs"
                      placeholder={t('download.autoFolderPlaceholder')}
                      readOnly
                      value={playlistCustomDownloadPath || settings.downloadPath}
                    />
                    <div className="absolute top-1/2 right-2 -translate-y-1/2">
                      <FolderOpen className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </div>
                  <Button
                    className="h-8"
                    disabled={playlistBusy}
                    onClick={handleSelectPlaylistDirectory}
                    size="sm"
                    variant="outline"
                  >
                    {t('settings.selectPath')}
                  </Button>
                  {playlistCustomDownloadPath && (
                    <Button
                      className="h-8 text-xs"
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
