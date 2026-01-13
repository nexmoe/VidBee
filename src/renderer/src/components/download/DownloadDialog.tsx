import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'

import { popularSites } from '@renderer/data/popularSites'
import { cn } from '@renderer/lib/utils'

import type { PlaylistInfo } from '@shared/types'
import {
  buildAudioFormatPreference,
  buildVideoFormatPreference
} from '@shared/utils/format-preferences'
import { useAtom, useSetAtom } from 'jotai'
import { AlertCircle, FolderOpen, List, Loader2, Plus, Video } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcEvents, ipcServices } from '../../lib/ipc'
import {
  addDownloadAtom,
  addHistoryRecordAtom,
  removeDownloadAtom,
  updateDownloadAtom
} from '../../store/downloads'
import { loadSettingsAtom, settingsAtom } from '../../store/settings'
import {
  currentVideoInfoAtom,
  fetchVideoInfoAtom,
  videoInfoErrorAtom,
  videoInfoLoadingAtom
} from '../../store/video'
import { AdvancedOptions } from '../video/AdvancedOptions'
import { VideoInfoCard, type VideoInfoCardState } from '../video/VideoInfoCard'

interface DownloadDialogProps {
  onOpenSupportedSites?: () => void
  onOpenSettings?: () => void
}

export function DownloadDialog({ onOpenSupportedSites, onOpenSettings }: DownloadDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [videoInfo, _setVideoInfo] = useAtom(currentVideoInfoAtom)
  const [loading] = useAtom(videoInfoLoadingAtom)
  const [error] = useAtom(videoInfoErrorAtom)
  const [settings] = useAtom(settingsAtom)
  const fetchVideoInfo = useSetAtom(fetchVideoInfoAtom)
  const loadSettings = useSetAtom(loadSettingsAtom)
  const updateDownload = useSetAtom(updateDownloadAtom)
  const addDownload = useSetAtom(addDownloadAtom)
  const addHistoryRecord = useSetAtom(addHistoryRecordAtom)
  const removeDownload = useSetAtom(removeDownloadAtom)

  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState<'single' | 'playlist'>('single')
  const inlinePreviewSites = popularSites
    .slice(0, 3)
    .map((site) => t(`sites.popular.${site.id}.label`))
    .join(', ')

  // VideoInfoCard state management
  const [videoInfoCardState, setVideoInfoCardState] = useState<VideoInfoCardState>({
    title: '',
    activeTab: 'video',
    selectedVideoFormat: '',
    selectedAudioForVideo: '',
    selectedAudioFormat: '',
    startTime: '',
    endTime: '',
    downloadSubs: false,
    customDownloadPath: '',
    audioExtractor: {
      extractFormat: 'mp3',
      extractQuality: '5'
    }
  })

  // Playlist states
  const playlistUrlId = useId()
  const downloadTypeId = useId()
  const advancedOptionsId = useId()
  const singleVideoAdvancedOptionsId = useId()
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
  const [singleVideoAdvancedOptionsOpen, setSingleVideoAdvancedOptionsOpen] = useState(false)

  const computePlaylistRange = useCallback(
    (info: PlaylistInfo) => {
      const parsedStart = Math.max(parseInt(startIndex, 10) || 1, 1)
      const rawEnd = endIndex ? Math.max(parseInt(endIndex, 10), parsedStart) : undefined
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
    const range = computePlaylistRange(playlistInfo)
    const previewEnd = range.end ?? playlistInfo.entryCount
    return playlistInfo.entries.filter(
      (entry) => entry.index >= range.start && entry.index <= previewEnd
    )
  }, [playlistInfo, computePlaylistRange])

  const syncHistoryItem = useCallback(
    async (id: string) => {
      try {
        const historyItem = await ipcServices.history.getHistoryById(id)
        if (historyItem) {
          addHistoryRecord(historyItem)
          removeDownload(id)
        }
      } catch (error) {
        console.error('Failed to sync history item:', error)
      }
    },
    [addHistoryRecord, removeDownload]
  )

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
    if (!open) return

    // Load settings when dialog opens
    loadSettings()

    // Listen for download events from main process
    ipcEvents.on('download:started', (...args: unknown[]) => {
      const id = args[0] as string
      console.log('Download started:', id)
      updateDownload({ id, changes: { status: 'downloading' } })
    })

    ipcEvents.on('download:progress', (...args: unknown[]) => {
      const data = args[0] as { id: string; progress: unknown }
      console.log('Download progress:', data)
      const progress = data.progress as {
        percent: number
        currentSpeed?: string
        eta?: string
        downloaded?: string
        total?: string
      }
      updateDownload({
        id: data.id,
        changes: {
          progress: {
            percent: progress.percent || 0,
            currentSpeed: progress.currentSpeed || '',
            eta: progress.eta || '',
            downloaded: progress.downloaded || '',
            total: progress.total || ''
          },
          speed: progress.currentSpeed || ''
        }
      })
    })

    ipcEvents.on('download:completed', (...args: unknown[]) => {
      const id = args[0] as string
      console.log('Download completed:', id)
      updateDownload({ id, changes: { status: 'completed' } })
      toast.success(t('notifications.downloadCompleted'))
      void syncHistoryItem(id)
    })

    ipcEvents.on('download:error', (...args: unknown[]) => {
      const data = args[0] as { id: string; error: string }
      console.error('Download error:', data)
      updateDownload({ id: data.id, changes: { status: 'error', error: data.error } })
      toast.error(t('notifications.downloadFailed'))
      void syncHistoryItem(data.id)
    })

    ipcEvents.on('download:cancelled', (...args: unknown[]) => {
      const id = args[0] as string
      console.log('Download cancelled:', id)
      updateDownload({ id, changes: { status: 'cancelled' } })
      void syncHistoryItem(id)
    })

    return () => {
      // Event listeners are automatically cleaned up when the component unmounts
    }
  }, [open, loadSettings, syncHistoryItem, t, updateDownload])

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

      addDownload(downloadItem)

      try {
        await ipcServices.download.startDownload(id, {
          url: trimmedUrl,
          type: settings.oneClickDownloadType,
          format
        })

        try {
          const videoInfo = await ipcServices.download.getVideoInfo(trimmedUrl)

          updateDownload({
            id,
            changes: {
              title: videoInfo.title,
              thumbnail: videoInfo.thumbnail,
              duration: videoInfo.duration,
              description: videoInfo.description,
              channel: videoInfo.extractor_key,
              uploader: videoInfo.extractor_key,
              createdAt: Date.now(),
              startedAt: Date.now()
            }
          })

          await ipcServices.download.updateDownloadInfo(id, {
            title: videoInfo.title,
            thumbnail: videoInfo.thumbnail,
            duration: videoInfo.duration,
            description: videoInfo.description,
            channel: videoInfo.extractor_key,
            uploader: videoInfo.extractor_key,
            createdAt: Date.now(),
            startedAt: Date.now()
          })

          toast.success(t('download.videoInfoUpdated'))
        } catch (infoError) {
          console.warn('Failed to fetch video info for one-click download:', infoError)
          updateDownload({
            id,
            changes: {
              title: t('download.infoUnavailable'),
              createdAt: Date.now(),
              startedAt: Date.now()
            }
          })

          await ipcServices.download.updateDownloadInfo(id, {
            title: t('download.infoUnavailable'),
            createdAt: Date.now(),
            startedAt: Date.now()
          })
        }

        toast.success(t('download.oneClickDownloadStarted'))
        if (options?.clearInput) {
          setUrl('')
        }
      } catch (error) {
        console.error('Failed to start one-click download:', error)
        toast.error(t('notifications.downloadFailed'))
      }
    },
    [settings, addDownload, updateDownload, t]
  )

  const handleFetchVideo = useCallback(async () => {
    if (!url.trim()) {
      toast.error(t('errors.emptyUrl'))
      return
    }
    await fetchVideoInfo(url.trim())
  }, [url, fetchVideoInfo, t])

  const handlePasteUrl = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        toast.error(t('errors.clipboardEmpty'))
        return
      }
      const trimmedUrl = text.trim()
      setUrl(trimmedUrl)
      inputRef.current?.focus()

      // Auto-fetch video info after pasting
      if (settings.oneClickDownload) {
        await startOneClickDownload(trimmedUrl, { setInputValue: false, clearInput: false })
        setOpen(false) // Close dialog after download starts
      } else {
        await fetchVideoInfo(trimmedUrl)
      }
    } catch (error) {
      console.error('Failed to paste URL:', error)
      toast.error(t('errors.pasteFromClipboard'))
    }
  }, [t, settings, startOneClickDownload, fetchVideoInfo])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleFetchVideo()
      }
    },
    [handleFetchVideo]
  )

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLInputElement>) => {
      // Let the default paste behavior happen first
      setTimeout(async () => {
        const pastedText = e.clipboardData.getData('text')
        if (!pastedText.trim()) return

        const trimmedUrl = pastedText.trim()
        // Only auto-fetch if the URL actually changed
        if (trimmedUrl !== url) {
          if (settings.oneClickDownload) {
            await startOneClickDownload(trimmedUrl, { setInputValue: false, clearInput: false })
            setOpen(false) // Close dialog after download starts
          } else {
            await fetchVideoInfo(trimmedUrl)
          }
        }
      }, 0)
    },
    [url, settings, startOneClickDownload, fetchVideoInfo]
  )

  const handlePlaylistPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLInputElement>) => {
      if (playlistBusy) return
      // Let the default paste behavior happen first
      setTimeout(async () => {
        const pastedText = e.clipboardData.getData('text')
        if (!pastedText.trim()) return

        const trimmed = pastedText.trim()
        // Only auto-preview if the URL actually changed
        if (trimmed !== playlistUrl && trimmed) {
          setPlaylistUrl(trimmed)
          setPlaylistInfo(null)
          setPlaylistPreviewError(null)
          setPlaylistCustomDownloadPath('')

          // Auto-preview playlist after pasting
          setPlaylistPreviewError(null)
          setPlaylistPreviewLoading(true)
          try {
            const info = await ipcServices.download.getPlaylistInfo(trimmed)
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
        }
      }, 0)
    },
    [playlistUrl, playlistBusy, t]
  )

  const handleOneClickDownload = useCallback(async () => {
    await startOneClickDownload(url, { clearInput: true })
    setOpen(false) // Close dialog after download starts
  }, [startOneClickDownload, url])

  // Playlist handlers
  const handlePastePlaylistUrl = useCallback(async () => {
    if (playlistBusy) return
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        toast.error(t('errors.clipboardEmpty'))
        return
      }
      const trimmed = text.trim()
      setPlaylistUrl(trimmed)
      setPlaylistInfo(null)
      setPlaylistPreviewError(null)
      setPlaylistCustomDownloadPath('')

      // Auto-preview playlist after pasting
      if (trimmed) {
        setPlaylistPreviewError(null)
        setPlaylistPreviewLoading(true)
        try {
          const info = await ipcServices.download.getPlaylistInfo(trimmed)
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
      }
    } catch (error) {
      console.error('Failed to paste URL:', error)
      toast.error(t('errors.pasteFromClipboard'))
    }
  }, [playlistBusy, t])

  const handleSelectPlaylistDirectory = useCallback(async () => {
    if (playlistBusy) return
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

      const range = computePlaylistRange(info)
      const previewEnd = range.end ?? info.entryCount

      if (previewEnd < range.start || previewEnd === 0) {
        toast.error(t('playlist.noEntriesInRange'))
        return
      }

      const format =
        downloadType === 'video'
          ? buildVideoFormatPreference(settings)
          : buildAudioFormatPreference(settings)

      const result = await ipcServices.download.startPlaylistDownload({
        url: trimmedUrl,
        type: downloadType,
        format,
        startIndex: range.start,
        endIndex: range.end,
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

      toast.success(t('playlist.downloadStarted', { count: result.totalCount }))
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
    playlistCustomDownloadPath
  ])

  // Update videoInfoCardState when videoInfo changes
  useEffect(() => {
    if (videoInfo) {
      setVideoInfoCardState((prev) => ({
        ...prev,
        title: videoInfo.title || prev.title
      }))
    }
  }, [videoInfo])

  // Handle video download from VideoInfoCard
  const handleVideoDownload = useCallback(
    async (type: 'video' | 'audio' | 'extract') => {
      if (!videoInfo) return

      const id = `download_${Date.now()}_${Math.random().toString(36).substring(7)}`

      const downloadItem = {
        id,
        url: videoInfo.webpage_url || '',
        title: videoInfoCardState.title,
        thumbnail: videoInfo.thumbnail,
        type: type === 'extract' ? 'audio' : type,
        status: 'pending' as const,
        progress: { percent: 0 },
        duration: videoInfo.duration,
        description: videoInfo.description,
        channel: videoInfo.extractor_key,
        uploader: videoInfo.extractor_key,
        createdAt: Date.now()
      }

      const options = {
        url: videoInfo.webpage_url || '',
        type,
        format:
          type === 'video'
            ? videoInfoCardState.selectedVideoFormat || undefined
            : type === 'extract'
              ? undefined
              : videoInfoCardState.selectedAudioFormat || undefined,
        audioFormat:
          type === 'video' ? videoInfoCardState.selectedAudioForVideo || undefined : undefined,
        extractFormat:
          type === 'extract' ? videoInfoCardState.audioExtractor.extractFormat : undefined,
        extractQuality:
          type === 'extract' ? videoInfoCardState.audioExtractor.extractQuality : undefined,
        startTime: videoInfoCardState.startTime || undefined,
        endTime: videoInfoCardState.endTime || undefined,
        downloadSubs: videoInfoCardState.downloadSubs,
        customDownloadPath: videoInfoCardState.customDownloadPath.trim() || undefined
      }

      addDownload(downloadItem)

      try {
        await ipcServices.download.startDownload(id, options)

        await ipcServices.download.updateDownloadInfo(id, {
          title: videoInfoCardState.title,
          thumbnail: videoInfo.thumbnail,
          duration: videoInfo.duration,
          description: videoInfo.description,
          channel: videoInfo.extractor_key,
          uploader: videoInfo.extractor_key,
          createdAt: Date.now()
        })

        toast.success(t('notifications.downloadStarted'))
        setOpen(false) // Close dialog after download starts
      } catch (error) {
        console.error('Failed to start download:', error)
        toast.error(t('notifications.downloadFailed'))
      }
    },
    [videoInfo, videoInfoCardState, addDownload, t]
  )

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      // Reset single video states
      setUrl('')
      setActiveTab('single')
      setSingleVideoAdvancedOptionsOpen(false)
      setVideoInfoCardState({
        title: '',
        activeTab: 'video',
        selectedVideoFormat: '',
        selectedAudioForVideo: '',
        selectedAudioFormat: '',
        startTime: '',
        endTime: '',
        downloadSubs: false,
        customDownloadPath: '',
        audioExtractor: {
          extractFormat: 'mp3',
          extractQuality: '5'
        }
      })

      // Reset playlist states
      setPlaylistUrl('')
      setPlaylistInfo(null)
      setPlaylistPreviewError(null)
      setPlaylistCustomDownloadPath('')
      setStartIndex('1')
      setEndIndex('')
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" className="h-10 w-10 rounded-full">
          <Plus className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <Tabs
          defaultValue="single"
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as 'single' | 'playlist')}
          className="w-full flex flex-col flex-1 min-h-0"
        >
          <DialogHeader className="shrink-0">
            <TabsList>
              <TabsTrigger value="single" onClick={() => setActiveTab('single')}>
                <Video className="h-4 w-4 mr-2" />
                {t('download.singleVideo')}
              </TabsTrigger>
              <TabsTrigger value="playlist" onClick={() => setActiveTab('playlist')}>
                <List className="h-4 w-4 mr-2" />
                {t('download.metadata.playlist')}
              </TabsTrigger>
            </TabsList>
          </DialogHeader>
          <ScrollArea className="flex-1 -mx-6 overflow-y-auto min-h-0">
            {/* Single Video Download Tab */}
            <TabsContent value="single" className="px-6 space-y-3 mt-3">
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      ref={inputRef}
                      placeholder={t('download.urlPlaceholder')}
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onPaste={handlePaste}
                      disabled={loading}
                      className="h-10"
                    />
                    {loading && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={handlePasteUrl}
                    variant="outline"
                    disabled={loading}
                    className="h-10"
                  >
                    {t('download.paste')}
                  </Button>
                </div>

                {/* Sub-info section */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{t('sites.homeInlineDescription', { sites: inlinePreviewSites })}</span>
                    <Button
                      type="button"
                      variant="link"
                      className="text-xs h-auto p-0"
                      onClick={() => {
                        setOpen(false)
                        onOpenSupportedSites?.()
                      }}
                    >
                      {t('sites.viewAll')}
                    </Button>
                  </div>
                </div>

                {/* One-click download indicator */}
                {settings.oneClickDownload && (
                  <div className="w-full">
                    <div className="rounded-lg border bg-muted/30 p-2.5">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{t('download.oneClickDownloadEnabled')}</span>
                        {onOpenSettings && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-xs h-auto"
                            onClick={() => {
                              setOpen(false)
                              onOpenSettings()
                            }}
                          >
                            {t('download.goToSettings')}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Error Display */}
                {error && (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                    <div className="flex items-start gap-2.5">
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-0.5 min-w-0">
                        <p className="text-sm font-semibold text-destructive">
                          {t('errors.fetchInfoFailed')}
                        </p>
                        <p className="text-xs text-muted-foreground wrap-break-word">{error}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Video Info and Download Options */}
                {videoInfo && !loading && (
                  <>
                    <VideoInfoCard
                      videoInfo={videoInfo}
                      state={videoInfoCardState}
                      onStateChange={(updates) =>
                        setVideoInfoCardState((prev) => ({ ...prev, ...updates }))
                      }
                      onTabChange={(tab) => {
                        setVideoInfoCardState((prev) => ({ ...prev, activeTab: tab }))
                      }}
                    />

                    {/* Download Location - Single Video */}
                    <div className="space-y-2 pt-4 border-t">
                      <Label>{t('advancedOptions.downloadLocation')}</Label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <div className="flex-1 relative">
                          <Input
                            value={videoInfoCardState.customDownloadPath || settings.downloadPath}
                            readOnly
                            className="pr-8"
                            placeholder={t('download.autoFolderPlaceholder')}
                          />
                          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={async () => {
                              try {
                                const path = await ipcServices.fs.selectDirectory()
                                if (path) {
                                  setVideoInfoCardState((prev) => ({
                                    ...prev,
                                    customDownloadPath: path
                                  }))
                                }
                              } catch (error) {
                                console.error('Failed to select directory:', error)
                                toast.error(t('settings.directorySelectError'))
                              }
                            }}
                            variant="outline"
                          >
                            {t('settings.selectPath')}
                          </Button>
                          {videoInfoCardState.customDownloadPath && (
                            <Button
                              onClick={() =>
                                setVideoInfoCardState((prev) => ({
                                  ...prev,
                                  customDownloadPath: ''
                                }))
                              }
                              variant="ghost"
                              size="sm"
                            >
                              {t('download.useAutoFolder')}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Advanced Options Content - Single Video */}
                {videoInfo && !loading && (
                  <div
                    data-state={singleVideoAdvancedOptionsOpen ? 'open' : 'closed'}
                    className={cn(
                      'grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out',
                      singleVideoAdvancedOptionsOpen
                        ? 'grid-rows-[1fr] opacity-100'
                        : 'grid-rows-[0fr] opacity-0'
                    )}
                    aria-hidden={!singleVideoAdvancedOptionsOpen}
                  >
                    <div
                      className={cn(
                        'min-h-0',
                        !singleVideoAdvancedOptionsOpen && 'pointer-events-none'
                      )}
                    >
                      <div className="w-full pt-4 mt-4 border-t">
                        <AdvancedOptions
                          startTime={videoInfoCardState.startTime}
                          endTime={videoInfoCardState.endTime}
                          downloadSubs={videoInfoCardState.downloadSubs}
                          onStartTimeChange={(value) =>
                            setVideoInfoCardState((prev) => ({ ...prev, startTime: value }))
                          }
                          onEndTimeChange={(value) =>
                            setVideoInfoCardState((prev) => ({ ...prev, endTime: value }))
                          }
                          onDownloadSubsChange={(value) =>
                            setVideoInfoCardState((prev) => ({ ...prev, downloadSubs: value }))
                          }
                          showAccordion={false}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Playlist Download Tab */}
            <TabsContent value="playlist" className="px-6 space-y-6 mt-3">
              <div className="space-y-6">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id={playlistUrlId}
                      placeholder="https://www.youtube.com/playlist?list=..."
                      value={playlistUrl}
                      onChange={(e) => {
                        setPlaylistUrl(e.target.value)
                        setPlaylistInfo(null)
                        setPlaylistPreviewError(null)
                        setPlaylistCustomDownloadPath('')
                      }}
                      onPaste={handlePlaylistPaste}
                      disabled={playlistBusy}
                    />
                    {playlistPreviewLoading && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={handlePastePlaylistUrl}
                    variant="outline"
                    disabled={playlistBusy}
                  >
                    {t('download.paste')}
                  </Button>
                </div>

                {/* Preview State */}
                {playlistInfo && !playlistPreviewLoading && (
                  <div className="space-y-6">
                    <div className="space-y-1 shrink-0">
                      <h3 className="font-semibold leading-none">{playlistInfo.title}</h3>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <List className="h-3.5 w-3.5" />
                        <span>{t('playlist.foundVideos', { count: playlistInfo.entryCount })}</span>
                        {selectedPlaylistEntries.length !== playlistInfo.entryCount && (
                          <>
                            <span>•</span>
                            <span className="text-primary font-medium">
                              {t('playlist.selectedVideos', {
                                count: selectedPlaylistEntries.length
                              })}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <ScrollArea className="h-[320px] w-full rounded-lg border">
                      <div className="p-1">
                        {selectedPlaylistEntries.map((entry) => (
                          <div
                            key={`${entry.index}-${entry.url}`}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors"
                          >
                            <div className="shrink-0 w-8 text-[10px] font-medium text-muted-foreground tabular-nums">
                              #{entry.index}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium line-clamp-1 leading-tight">
                                {entry.title || t('download.fetchingVideoInfo')}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>

                    {/* Download Location - Playlist */}
                    <div className="space-y-2 pt-4 border-t">
                      <Label>{t('advancedOptions.downloadLocation')}</Label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <div className="flex-1 relative">
                          <Input
                            value={playlistCustomDownloadPath || settings.downloadPath}
                            readOnly
                            className="pr-8"
                            placeholder={t('download.autoFolderPlaceholder')}
                          />
                          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={handleSelectPlaylistDirectory}
                            variant="outline"
                            disabled={playlistBusy}
                          >
                            {t('settings.selectPath')}
                          </Button>
                          {playlistCustomDownloadPath && (
                            <Button
                              onClick={() => setPlaylistCustomDownloadPath('')}
                              variant="ghost"
                              disabled={playlistBusy}
                            >
                              {t('download.useAutoFolder')}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {playlistPreviewError && (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-semibold text-destructive">
                          {t('playlist.previewFailed')}
                        </p>
                        <p className="text-xs text-muted-foreground">{playlistPreviewError}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Advanced Options Content - Playlist */}
                <div
                  data-state={advancedOptionsOpen ? 'open' : 'closed'}
                  className={cn(
                    'grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out',
                    advancedOptionsOpen
                      ? 'grid-rows-[1fr] opacity-100'
                      : 'grid-rows-[0fr] opacity-0'
                  )}
                  aria-hidden={!advancedOptionsOpen}
                >
                  <div className={cn('min-h-0', !advancedOptionsOpen && 'pointer-events-none')}>
                    <div className="w-full pt-4 mt-4 border-t">
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor={downloadTypeId}>{t('playlist.downloadType')}</Label>
                            <Select
                              value={downloadType}
                              onValueChange={(v) => setDownloadType(v as 'video' | 'audio')}
                              disabled={playlistBusy}
                            >
                              <SelectTrigger id={downloadTypeId}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="video">{t('download.video')}</SelectItem>
                                <SelectItem value="audio">{t('download.audio')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label>{t('playlist.range')}</Label>
                            <div className="flex items-center gap-2">
                              <Input
                                placeholder="1"
                                value={startIndex}
                                onChange={(e) => setStartIndex(e.target.value)}
                                className="text-center"
                                disabled={playlistBusy}
                              />
                              <span className="text-muted-foreground text-xs">-</span>
                              <Input
                                placeholder={playlistInfo?.entryCount.toString() || 'End'}
                                value={endIndex}
                                onChange={(e) => setEndIndex(e.target.value)}
                                className="text-center"
                                disabled={playlistBusy}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>
        <DialogFooter className="shrink-0 border-t pt-4 mt-4">
          <div className="flex items-center justify-between w-full gap-4">
            {(activeTab === 'playlist' || (activeTab === 'single' && videoInfo && !loading)) && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={activeTab === 'playlist' ? advancedOptionsId : singleVideoAdvancedOptionsId}
                  checked={
                    activeTab === 'playlist' ? advancedOptionsOpen : singleVideoAdvancedOptionsOpen
                  }
                  onCheckedChange={(checked) => {
                    if (activeTab === 'playlist') {
                      setAdvancedOptionsOpen(checked === true)
                    } else {
                      setSingleVideoAdvancedOptionsOpen(checked === true)
                    }
                  }}
                />
                <Label
                  htmlFor={
                    activeTab === 'playlist' ? advancedOptionsId : singleVideoAdvancedOptionsId
                  }
                  className="cursor-pointer"
                >
                  {t('advancedOptions.title')}
                </Label>
              </div>
            )}
            <div className="ml-auto flex gap-2">
              {activeTab === 'single' ? (
                !videoInfo ? (
                  settings.oneClickDownload ? (
                    <Button onClick={handleOneClickDownload} disabled={loading || !url.trim()}>
                      {loading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        t('download.oneClickDownloadNow')
                      )}
                    </Button>
                  ) : (
                    <Button onClick={handleFetchVideo} disabled={loading || !url.trim()}>
                      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : t('download.fetch')}
                    </Button>
                  )
                ) : videoInfoCardState.activeTab === 'video' ? (
                  <Button
                    onClick={() => handleVideoDownload('video')}
                    disabled={
                      loading ||
                      !videoInfoCardState.selectedVideoFormat ||
                      (videoInfoCardState.selectedAudioForVideo === 'none' &&
                        !videoInfoCardState.selectedAudioForVideo)
                    }
                    size="lg"
                  >
                    {t('download.downloadVideo')}
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => handleVideoDownload('audio')}
                      disabled={loading || !videoInfoCardState.selectedAudioFormat}
                      size="lg"
                    >
                      {t('download.downloadAudio')}
                    </Button>
                    <Button
                      onClick={() => handleVideoDownload('extract')}
                      disabled={loading}
                      variant="outline"
                      size="lg"
                    >
                      {t('audioExtract.extract')}
                    </Button>
                  </>
                )
              ) : playlistInfo && !playlistPreviewLoading ? (
                <Button
                  onClick={handleDownloadPlaylist}
                  disabled={playlistDownloadLoading || selectedPlaylistEntries.length === 0}
                  size="lg"
                >
                  {playlistDownloadLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    t('playlist.downloadCurrentRange')
                  )}
                </Button>
              ) : (
                <Button
                  onClick={handlePreviewPlaylist}
                  disabled={playlistBusy || !playlistUrl.trim()}
                  size="lg"
                >
                  {playlistPreviewLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    t('download.fetch')
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
