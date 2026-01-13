import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@renderer/components/ui/dialog'
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

import { cn } from '@renderer/lib/utils'

import type { AppSettings, OneClickQualityPreset, PlaylistInfo, VideoFormat } from '@shared/types'
import { useAtom, useSetAtom } from 'jotai'
import { AlertCircle, FolderOpen, List, Loader2, Plus, Video } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
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
import { VideoInfoCard, type VideoInfoCardState } from '../video/VideoInfoCard'

const qualityPresetToVideoHeight: Record<OneClickQualityPreset, number | null> = {
  best: null,
  good: 1080,
  normal: 720,
  bad: 480,
  worst: 360
}

const qualityPresetToAudioAbr: Record<OneClickQualityPreset, number | null> = {
  best: 320,
  good: 256,
  normal: 192,
  bad: 128,
  worst: 96
}

const dedupe = (candidates: Array<string | undefined>): string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of candidates) {
    if (!candidate) continue
    if (seen.has(candidate)) continue
    seen.add(candidate)
    result.push(candidate)
  }
  return result
}

const isLikelyUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const getQualityPreset = (settings: AppSettings): OneClickQualityPreset =>
  settings.oneClickQuality ?? 'best'

const buildAudioSelectors = (preset: OneClickQualityPreset): string[] => {
  if (preset === 'worst') {
    return dedupe(['worstaudio', 'bestaudio'])
  }

  const abrLimit = qualityPresetToAudioAbr[preset]
  // Prefer audio-only selectors so video+audio merges remain valid.
  return dedupe([abrLimit ? `bestaudio[abr<=${abrLimit}]` : undefined, 'bestaudio'])
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
    if (a === 'und') return 1
    if (b === 'und') return -1
    return a.localeCompare(b)
  })

  return sortedLanguages
    .map(([, languageFormats]) => {
      const sorted = [...languageFormats].sort(sortAudioFormatsByQuality)
      return sorted[0]?.format_id
    })
    .filter((id): id is string => !!id)
}

const buildVideoFormatPreference = (settings: AppSettings): string => {
  const preset = getQualityPreset(settings)

  if (preset === 'worst') {
    // Prefer separate streams, then fall back to single-file selectors.
    return 'worstvideo+worstaudio/worst/best'
  }

  const maxHeight = qualityPresetToVideoHeight[preset]
  const videoCandidates = dedupe([
    maxHeight ? `bestvideo[height<=${maxHeight}]` : undefined,
    'bestvideo'
  ])

  const audioSelectors = buildAudioSelectors(preset)
  const combinations: string[] = []

  for (const video of videoCandidates) {
    for (const audio of audioSelectors) {
      combinations.push(`${video}+${audio}`)
    }
  }

  if (audioSelectors.includes('none')) {
    for (const video of videoCandidates) {
      combinations.push(video)
    }
  } else {
    // Prefer merged formats, then allow 'best' as a compatibility fallback.
    combinations.push('bestvideo+bestaudio')
  }

  combinations.push('best')

  return dedupe(combinations).join('/')
}

const buildAudioFormatPreference = (settings: AppSettings): string => {
  const selectors = buildAudioSelectors(getQualityPreset(settings))
  return dedupe([...selectors, 'best']).join('/')
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
  const [activeTab, setActiveTab] = useState<'single' | 'playlist'>('single')

  // VideoInfoCard state management
  const [videoInfoCardState, setVideoInfoCardState] = useState<VideoInfoCardState>({
    title: '',
    activeTab: 'video',
    selectedVideoFormat: '',
    selectedAudioFormat: '',
    customDownloadPath: ''
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
    if (!open) return
    void handleAutoDetectClipboard()
  }, [open, handleAutoDetectClipboard])

  const handleOneClickDownload = useCallback(async () => {
    await startOneClickDownload(url, { clearInput: true })
    setOpen(false) // Close dialog after download starts
  }, [startOneClickDownload, url])

  // Playlist handlers
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
        endIndex = selectedIndices[selectedIndices.length - 1]
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
    playlistCustomDownloadPath,
    selectedEntryIds
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
    async (type: 'video' | 'audio') => {
      if (!videoInfo) return

      const id = `download_${Date.now()}_${Math.random().toString(36).substring(7)}`

      const downloadItem = {
        id,
        url: videoInfo.webpage_url || '',
        title: videoInfoCardState.title,
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
        format:
          type === 'video'
            ? videoInfoCardState.selectedVideoFormat || undefined
            : videoInfoCardState.selectedAudioFormat || undefined,
        audioFormat: type === 'video' ? 'best' : undefined,
        audioFormatIds: audioFormatIds && audioFormatIds.length > 0 ? audioFormatIds : undefined,
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
      setVideoInfoCardState({
        title: '',
        activeTab: 'video',
        selectedVideoFormat: '',
        selectedAudioFormat: '',
        customDownloadPath: ''
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        className="rounded-full"
        onClick={() => {
          void handleOpenDialog()
        }}
      >
        <Plus className="h-4 w-4" />
        {t('download.pasteUrlButton')}
      </Button>
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
          {/* Single Video Download Tab */}
          <TabsContent value="single" className="flex flex-col flex-1 min-h-0 mt-3">
            {/* Error Display */}
            {error && (
              <div className="shrink-0 mb-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
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
            {(loading || videoInfo) && (
              <VideoInfoCard
                videoInfo={videoInfo}
                loading={loading}
                state={videoInfoCardState}
                onStateChange={(updates) =>
                  setVideoInfoCardState((prev) => ({ ...prev, ...updates }))
                }
                onTabChange={(tab) => {
                  setVideoInfoCardState((prev) => ({ ...prev, activeTab: tab }))
                }}
              />
            )}
          </TabsContent>

          {/* Playlist Download Tab */}
          <TabsContent value="playlist" className="px-6 space-y-6 mt-3">
            <ScrollArea className="flex-1 -mx-6 overflow-y-auto min-h-0">
              <div className="space-y-6">
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
                        {playlistInfo.entries.map((entry) => {
                          const isSelected = selectedEntryIds.has(entry.id)
                          const isInRange =
                            selectedEntryIds.size === 0 &&
                            selectedPlaylistEntries.some((e) => e.id === entry.id)

                          const handleToggle = () => {
                            setSelectedEntryIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(entry.id)) {
                                next.delete(entry.id)
                              } else {
                                next.add(entry.id)
                              }
                              return next
                            })
                            // Clear range inputs when manual selection is used
                            if (selectedEntryIds.size === 0) {
                              setStartIndex('1')
                              setEndIndex('')
                            }
                          }

                          return (
                            <button
                              key={entry.id}
                              type="button"
                              className={cn(
                                'flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors cursor-pointer w-full text-left',
                                isSelected || isInRange
                                  ? 'bg-primary/10 hover:bg-primary/20'
                                  : 'hover:bg-muted/50'
                              )}
                              onClick={handleToggle}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  handleToggle()
                                }
                              }}
                              aria-label={t('playlist.selectEntry', { index: entry.index })}
                            >
                              <Checkbox
                                checked={isSelected || isInRange}
                                onCheckedChange={(checked) => {
                                  setSelectedEntryIds((prev) => {
                                    const next = new Set(prev)
                                    if (checked) {
                                      next.add(entry.id)
                                    } else {
                                      next.delete(entry.id)
                                    }
                                    return next
                                  })
                                  if (selectedEntryIds.size === 0) {
                                    setStartIndex('1')
                                    setEndIndex('')
                                  }
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="shrink-0"
                              />
                              <div className="shrink-0 w-8 text-[10px] font-medium text-muted-foreground tabular-nums">
                                #{entry.index}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium line-clamp-1 leading-tight">
                                  {entry.title || t('download.fetchingVideoInfo')}
                                </p>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </ScrollArea>
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
                                onChange={(e) => {
                                  setStartIndex(e.target.value)
                                  // Clear manual selection when using range
                                  if (selectedEntryIds.size > 0) {
                                    setSelectedEntryIds(new Set())
                                  }
                                }}
                                className="text-center"
                                disabled={playlistBusy}
                              />
                              <span className="text-muted-foreground text-xs">-</span>
                              <Input
                                placeholder={playlistInfo?.entryCount.toString() || 'End'}
                                value={endIndex}
                                onChange={(e) => {
                                  setEndIndex(e.target.value)
                                  // Clear manual selection when using range
                                  if (selectedEntryIds.size > 0) {
                                    setSelectedEntryIds(new Set())
                                  }
                                }}
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
            </ScrollArea>
          </TabsContent>
        </Tabs>
        <DialogFooter className="shrink-0">
          <div className="flex items-center justify-between w-full gap-4">
            <div className="flex items-center gap-4">
              {/* Download Location - Single Video */}
              {activeTab === 'single' && videoInfo && !loading && (
                <div className="flex items-center gap-2">
                  <div className="relative w-[280px]">
                    <Input
                      value={videoInfoCardState.customDownloadPath || settings.downloadPath}
                      readOnly
                      className="pr-8 text-xs"
                      placeholder={t('download.autoFolderPlaceholder')}
                    />
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </div>
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
              )}

              {/* Download Location - Playlist */}
              {activeTab === 'playlist' && playlistInfo && !playlistPreviewLoading && (
                <div className="flex items-center gap-2">
                  <div className="relative w-[200px]">
                    <Input
                      value={playlistCustomDownloadPath || settings.downloadPath}
                      readOnly
                      className="pr-8 text-xs"
                      placeholder={t('download.autoFolderPlaceholder')}
                    />
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </div>
                  <Button
                    onClick={handleSelectPlaylistDirectory}
                    variant="outline"
                    size="sm"
                    disabled={playlistBusy}
                  >
                    {t('settings.selectPath')}
                  </Button>
                  {playlistCustomDownloadPath && (
                    <Button
                      onClick={() => setPlaylistCustomDownloadPath('')}
                      variant="ghost"
                      size="sm"
                      disabled={playlistBusy}
                    >
                      {t('download.useAutoFolder')}
                    </Button>
                  )}
                </div>
              )}

              {/* Advanced Options - Playlist (when no playlist info) */}
              {activeTab === 'playlist' && !playlistInfo && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={advancedOptionsId}
                    checked={advancedOptionsOpen}
                    onCheckedChange={(checked) => {
                      setAdvancedOptionsOpen(checked === true)
                    }}
                  />
                  <Label htmlFor={advancedOptionsId} className="cursor-pointer">
                    {t('advancedOptions.title')}
                  </Label>
                </div>
              )}
            </div>
            <div className="ml-auto flex gap-2">
              {activeTab === 'single' ? (
                !videoInfo ? (
                  <Button
                    onClick={settings.oneClickDownload ? handleOneClickDownload : handleFetchVideo}
                    disabled={loading || !url.trim()}
                  >
                    {settings.oneClickDownload
                      ? t('download.oneClickDownloadNow')
                      : t('download.startDownload')}
                  </Button>
                ) : videoInfoCardState.activeTab === 'video' ? (
                  <Button
                    onClick={() => handleVideoDownload('video')}
                    disabled={loading || !videoInfoCardState.selectedVideoFormat}
                    size="lg"
                  >
                    {t('download.downloadVideo')}
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleVideoDownload('audio')}
                    disabled={loading || !videoInfoCardState.selectedAudioFormat}
                    size="lg"
                  >
                    {t('download.downloadAudio')}
                  </Button>
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
