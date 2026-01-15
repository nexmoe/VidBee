import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'

import type { PlaylistInfo, VideoFormat } from '@shared/types'
import {
  buildAudioFormatPreference,
  buildVideoFormatPreference
} from '@shared/utils/format-preferences'
import { useAtom, useSetAtom } from 'jotai'
import {
  FolderOpen,
  Github,
  List,
  Loader2,
  MessageCircle,
  Plus,
  Twitter,
  Video
} from 'lucide-react'
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
import { PlaylistDownload } from './PlaylistDownload'
import {
  type FeedbackLink,
  SingleVideoDownload,
  type SingleVideoState
} from './SingleVideoDownload'

const isLikelyUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const normalizeErrorText = (value?: string | null): string =>
  value ? value.replace(/\s+/g, ' ').trim() : ''

const clampText = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value

const FEEDBACK_TWEET_PREFIX = '@nexmoex VidBee'
const FEEDBACK_ISSUE_TITLE = 'Download error report'
const FEEDBACK_ISSUE_OBSERVED_PREFIX = 'Download failed with error: '
const FEEDBACK_UNKNOWN_ERROR = 'Unknown error'
const FEEDBACK_UNKNOWN_VALUE = 'Unknown'
const FEEDBACK_SOURCE_LABEL = 'Source URL'
const FEEDBACK_ERROR_LABEL = 'Error'
const FEEDBACK_APP_VERSION_PREFIX = 'VidBee v'

const buildIssueLogs = (
  errorText: string,
  sourceUrl: string | undefined,
  urlLabel: string,
  errorLabel: string
): string => {
  const lines: string[] = []
  if (sourceUrl) {
    lines.push(`${urlLabel}: ${sourceUrl}`)
  }
  lines.push(`${errorLabel}: ${errorText}`)
  return lines.join('\n')
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

interface DownloadDialogProps {
  onOpenSupportedSites?: () => void
  onOpenSettings?: () => void
}

export function DownloadDialog({
  onOpenSupportedSites: _onOpenSupportedSites,
  onOpenSettings: _onOpenSettings
}: DownloadDialogProps) {
  const { t } = useTranslation()
  const [appVersion, setAppVersion] = useState('')
  const [osVersion, setOsVersion] = useState('')
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
  const feedbackLinks: FeedbackLink[] = useMemo(() => {
    const compactError = normalizeErrorText(error)
    const tweetError = compactError ? clampText(compactError, 160) : ''
    const tweetText = encodeURIComponent(
      tweetError ? `${FEEDBACK_TWEET_PREFIX} - ${tweetError}` : FEEDBACK_TWEET_PREFIX
    )
    const issueError = compactError ? clampText(compactError, 800) : FEEDBACK_UNKNOWN_ERROR
    const issueTitle = FEEDBACK_ISSUE_TITLE
    const issueObserved = clampText(`${FEEDBACK_ISSUE_OBSERVED_PREFIX}${issueError}`, 300)
    const sourceUrl = url.trim() || undefined
    const issueLogs = clampText(
      buildIssueLogs(issueError, sourceUrl, FEEDBACK_SOURCE_LABEL, FEEDBACK_ERROR_LABEL),
      800
    )
    const appVersionValue = appVersion
      ? `${FEEDBACK_APP_VERSION_PREFIX}${appVersion}`
      : FEEDBACK_UNKNOWN_VALUE
    const osVersionValue = osVersion || FEEDBACK_UNKNOWN_VALUE
    return [
      {
        icon: Github,
        label: t('about.resources.githubIssues'),
        href: `https://github.com/nexmoe/VidBee/issues/new?template=bug_report.yml&title=${encodeURIComponent(
          issueTitle
        )}&actual=${encodeURIComponent(issueObserved)}&logs=${encodeURIComponent(
          issueLogs
        )}&app_version=${encodeURIComponent(appVersionValue)}&os_version=${encodeURIComponent(
          osVersionValue
        )}`
      },
      {
        icon: Twitter,
        label: t('about.resources.xFeedback'),
        href: `https://x.com/intent/tweet?text=${tweetText}`
      },
      {
        icon: MessageCircle,
        label: t('about.resources.discord'),
        href: 'https://discord.gg/uBqXV6QPdm'
      }
    ]
  }, [appVersion, error, osVersion, t, url])

  useEffect(() => {
    let isActive = true

    const loadAppInfo = async () => {
      try {
        const [version, osRelease] = await Promise.all([
          ipcServices.app.getVersion(),
          ipcServices.app.getOsVersion()
        ])
        if (!isActive) {
          return
        }
        setAppVersion(version)
        setOsVersion(osRelease)
      } catch (loadError) {
        console.error('Failed to load app info for feedback links:', loadError)
      }
    }

    void loadAppInfo()

    return () => {
      isActive = false
    }
  }, [])

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
    if (!videoInfo) return

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

    addDownload(downloadItem)

    try {
      await ipcServices.download.startDownload(id, options)

      await ipcServices.download.updateDownloadInfo(id, {
        title: singleVideoState.title || videoInfo.title || t('download.fetchingVideoInfo'),
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
      <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col p-5 gap-0">
        <Tabs
          defaultValue="single"
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as 'single' | 'playlist')}
          className="w-full flex flex-col flex-1 min-h-0 gap-0"
        >
          <DialogHeader>
            <TabsList>
              <TabsTrigger value="single" onClick={() => setActiveTab('single')}>
                <Video className="h-3.5 w-3.5" />
                {t('download.singleVideo')}
              </TabsTrigger>
              <TabsTrigger value="playlist" onClick={() => setActiveTab('playlist')}>
                <List className="h-3.5 w-3.5" />
                {t('download.metadata.playlist')}
              </TabsTrigger>
            </TabsList>
          </DialogHeader>
          {/* Single Video Download Tab */}
          <TabsContent value="single" className="flex flex-col flex-1 min-h-0 mt-0">
            <SingleVideoDownload
              loading={loading}
              error={error}
              videoInfo={videoInfo}
              state={singleVideoState}
              feedbackLinks={feedbackLinks}
              onStateChange={handleSingleVideoStateChange}
            />
          </TabsContent>

          {/* Playlist Download Tab */}
          <TabsContent value="playlist" className="flex flex-col flex-1 min-h-0 mt-0">
            <PlaylistDownload
              playlistPreviewLoading={playlistPreviewLoading}
              playlistPreviewError={playlistPreviewError}
              playlistInfo={playlistInfo}
              playlistBusy={playlistBusy}
              selectedPlaylistEntries={selectedPlaylistEntries}
              selectedEntryIds={selectedEntryIds}
              downloadType={downloadType}
              downloadTypeId={downloadTypeId}
              startIndex={startIndex}
              endIndex={endIndex}
              advancedOptionsOpen={advancedOptionsOpen}
              setSelectedEntryIds={setSelectedEntryIds}
              setStartIndex={setStartIndex}
              setEndIndex={setEndIndex}
              setDownloadType={setDownloadType}
            />
          </TabsContent>
        </Tabs>
        <DialogFooter className="shrink-0 pt-3 border-t">
          <div className="flex items-center justify-between w-full gap-3">
            <div className="flex items-center gap-3">
              {/* Download Location - Single Video */}
              {activeTab === 'single' && videoInfo && !loading && (
                <div className="flex items-center gap-2">
                  <div className="relative w-[240px]">
                    <Input
                      value={singleVideoState.customDownloadPath || settings.downloadPath}
                      readOnly
                      className="pr-7"
                      placeholder={t('download.autoFolderPlaceholder')}
                    />
                    <div className="absolute right-0 top-1/2 -translate-y-1/2">
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
                        variant="ghost"
                        size="icon"
                      >
                        <FolderOpen className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>

                  {singleVideoState.customDownloadPath && (
                    <Button
                      onClick={() =>
                        setSingleVideoState((prev) => ({
                          ...prev,
                          customDownloadPath: ''
                        }))
                      }
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
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
                      className="pr-7 text-xs h-8 bg-muted/30"
                      placeholder={t('download.autoFolderPlaceholder')}
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                      <FolderOpen className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </div>
                  <Button
                    onClick={handleSelectPlaylistDirectory}
                    variant="outline"
                    size="sm"
                    disabled={playlistBusy}
                    className="h-8"
                  >
                    {t('settings.selectPath')}
                  </Button>
                  {playlistCustomDownloadPath && (
                    <Button
                      onClick={() => setPlaylistCustomDownloadPath('')}
                      variant="ghost"
                      size="sm"
                      disabled={playlistBusy}
                      className="h-8 text-xs"
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
                    id={advancedOptionsId}
                    checked={advancedOptionsOpen}
                    onCheckedChange={(checked) => {
                      setAdvancedOptionsOpen(checked === true)
                    }}
                  />
                  <Label htmlFor={advancedOptionsId} className="cursor-pointer text-xs">
                    {t('advancedOptions.title')}
                  </Label>
                </div>
              )}
            </div>
            <div className="ml-auto flex gap-2">
              {activeTab === 'single' ? (
                !videoInfo && !loading ? (
                  <Button
                    onClick={settings.oneClickDownload ? handleOneClickDownload : handleFetchVideo}
                    disabled={loading || !url.trim()}
                  >
                    {settings.oneClickDownload
                      ? t('download.oneClickDownloadNow')
                      : t('download.startDownload')}
                  </Button>
                ) : !loading && videoInfo ? (
                  <Button
                    onClick={handleSingleVideoDownload}
                    disabled={loading || !selectedSingleFormat}
                  >
                    {singleVideoState.activeTab === 'video'
                      ? t('download.downloadVideo')
                      : t('download.downloadAudio')}
                  </Button>
                ) : null
              ) : playlistInfo && !playlistPreviewLoading ? (
                <Button
                  onClick={handleDownloadPlaylist}
                  disabled={playlistDownloadLoading || selectedPlaylistEntries.length === 0}
                >
                  {playlistDownloadLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    t('playlist.downloadCurrentRange')
                  )}
                </Button>
              ) : !playlistPreviewLoading ? (
                <Button
                  onClick={handlePreviewPlaylist}
                  disabled={playlistBusy || !playlistUrl.trim()}
                >
                  {playlistPreviewLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    t('download.startDownload')
                  )}
                </Button>
              ) : null}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
