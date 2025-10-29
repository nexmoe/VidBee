import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { popularSites } from '@renderer/data/popularSites'
import type { AppSettings, OneClickQualityPreset, PlaylistInfo } from '@shared/types'
import { useAtom, useSetAtom } from 'jotai'
import { AlertCircle, Download, ListVideo, Loader2, Search } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { UnifiedDownloadHistory } from '../components/download/UnifiedDownloadHistory'
import { PlaylistPreviewCard } from '../components/playlist/PlaylistPreviewCard'
import { VideoInfoCard } from '../components/video/VideoInfoCard'
import { ipcEvents, ipcServices } from '../lib/ipc'
import {
  addDownloadAtom,
  addHistoryRecordAtom,
  removeDownloadAtom,
  updateDownloadAtom
} from '../store/downloads'
import { loadSettingsAtom, settingsAtom } from '../store/settings'
import {
  currentVideoInfoAtom,
  fetchVideoInfoAtom,
  videoInfoErrorAtom,
  videoInfoLoadingAtom
} from '../store/video'

const qualityPresetToVideoHeight: Record<OneClickQualityPreset, number | null> = {
  auto: null,
  best: null,
  good: 1080,
  normal: 720,
  bad: 480,
  worst: 360
}

const qualityPresetToAudioAbr: Record<OneClickQualityPreset, number | null> = {
  auto: null,
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

const getQualityPreset = (settings: AppSettings): OneClickQualityPreset =>
  settings.oneClickQuality ?? 'auto'

const buildAudioSelectors = (preset: OneClickQualityPreset): string[] => {
  if (preset === 'worst') {
    return ['worstaudio', 'worst']
  }

  const abrLimit = qualityPresetToAudioAbr[preset]
  return dedupe([abrLimit ? `bestaudio[abr<=${abrLimit}]` : undefined, 'bestaudio', 'best'])
}

const buildVideoFormatPreference = (settings: AppSettings): string => {
  const preset = getQualityPreset(settings)

  if (preset === 'worst') {
    return 'worstvideo+worstaudio/worst'
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
    combinations.push('best')
  }

  return dedupe(combinations).join('/')
}

const buildAudioFormatPreference = (settings: AppSettings): string => {
  const selectors = buildAudioSelectors(getQualityPreset(settings))
  return selectors.join('/')
}

interface HomeProps {
  onOpenSupportedSites?: () => void
}

export function Home({ onOpenSupportedSites }: HomeProps) {
  const { t } = useTranslation()
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
  const inlinePreviewSites = popularSites
    .slice(0, 3)
    .map((site) => t(`sites.popular.${site.id}.label`))
    .join(', ')

  // Playlist states
  const playlistUrlId = useId()
  const downloadTypeId = useId()
  const [playlistUrl, setPlaylistUrl] = useState('')
  const [downloadType, setDownloadType] = useState<'video' | 'audio'>('video')
  const [startIndex, setStartIndex] = useState('1')
  const [endIndex, setEndIndex] = useState('')
  const [playlistInfo, setPlaylistInfo] = useState<PlaylistInfo | null>(null)
  const [playlistPreviewLoading, setPlaylistPreviewLoading] = useState(false)
  const [playlistDownloadLoading, setPlaylistDownloadLoading] = useState(false)
  const [playlistPreviewError, setPlaylistPreviewError] = useState<string | null>(null)
  const playlistBusy = playlistPreviewLoading || playlistDownloadLoading

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

  useEffect(() => {
    // Load settings on mount
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
      // Note: Event listeners are automatically cleaned up when the component unmounts
      // The removeListener calls are not needed as the event system handles cleanup
    }
  }, [loadSettings, syncHistoryItem, t, updateDownload])

  const handlePasteUrl = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        toast.error(t('errors.clipboardEmpty'))
        return
      }
      setUrl(text.trim())
      inputRef.current?.focus()
    } catch (error) {
      console.error('Failed to paste URL:', error)
      toast.error(t('errors.pasteFromClipboard'))
    }
  }, [t])

  const handleFetchVideo = useCallback(async () => {
    if (!url.trim()) {
      toast.error(t('errors.emptyUrl'))
      return
    }
    await fetchVideoInfo(url.trim())
  }, [url, fetchVideoInfo, t])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleFetchVideo()
      }
    },
    [handleFetchVideo]
  )

  const handleOneClickDownload = useCallback(async () => {
    if (!url.trim()) {
      toast.error(t('errors.emptyUrl'))
      return
    }

    const id = `download_${Date.now()}_${Math.random().toString(36).substring(7)}`

    // Create initial download item with placeholder info
    const trimmedUrl = url.trim()

    const downloadItem = {
      id,
      url: trimmedUrl,
      title: t('download.fetchingVideoInfo'),
      type: settings.oneClickDownloadType,
      status: 'pending' as const,
      progress: { percent: 0 },
      createdAt: Date.now()
    }

    const options = {
      url: trimmedUrl,
      type: settings.oneClickDownloadType,
      format:
        settings.oneClickDownloadType === 'video'
          ? buildVideoFormatPreference(settings)
          : buildAudioFormatPreference(settings)
    }

    addDownload(downloadItem)

    try {
      // Start download immediately
      await ipcServices.download.startDownload(id, options)

      // Fetch video info in parallel to update the download item
      try {
        const videoInfo = await ipcServices.download.getVideoInfo(url.trim())

        // Update the download item in the renderer state
        updateDownload({
          id,
          changes: {
            title: videoInfo.title,
            thumbnail: videoInfo.thumbnail,
            duration: videoInfo.duration,
            description: videoInfo.description,
            // Extract additional metadata if available
            channel: videoInfo.extractor_key,
            uploader: videoInfo.extractor_key,
            createdAt: Date.now(),
            startedAt: Date.now()
          }
        })

        // Also update the download info in the main process queue
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

        // Show a subtle notification that video info was updated
        toast.success(t('download.videoInfoUpdated'))
      } catch (infoError) {
        console.warn('Failed to fetch video info for one-click download:', infoError)
        // Keep the placeholder title if video info fetch fails
        // Update the title to indicate info fetch failed
        updateDownload({
          id,
          changes: {
            title: t('download.infoUnavailable'),
            createdAt: Date.now(),
            startedAt: Date.now()
          }
        })

        // Also update the main process queue
        await ipcServices.download.updateDownloadInfo(id, {
          title: t('download.infoUnavailable'),
          createdAt: Date.now(),
          startedAt: Date.now()
        })
      }

      toast.success(t('download.oneClickDownloadStarted'))
      setUrl('') // Clear the URL after starting download
    } catch (error) {
      console.error('Failed to start one-click download:', error)
      toast.error(t('notifications.downloadFailed'))
    }
  }, [url, settings, addDownload, updateDownload, t])

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
    } catch (error) {
      console.error('Failed to paste URL:', error)
      toast.error(t('errors.pasteFromClipboard'))
    }
  }, [playlistBusy, t])

  const handleClearPlaylistPreview = useCallback(() => {
    setPlaylistInfo(null)
    setPlaylistPreviewError(null)
  }, [])

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
        endIndex: range.end
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
    } catch (error) {
      console.error('Failed to start playlist download:', error)
      toast.error(t('playlist.downloadFailed'))
    } finally {
      setPlaylistDownloadLoading(false)
    }
  }, [playlistUrl, playlistInfo, computePlaylistRange, downloadType, settings, addDownload, t])

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div
      className="container mx-auto max-w-7xl p-6 space-y-6 overflow-hidden w-full"
      style={{ maxWidth: '100%' }}
    >
      <Tabs defaultValue="single" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="single" className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            {t('download.singleVideo')}
          </TabsTrigger>
          <TabsTrigger value="playlist" className="flex items-center gap-2">
            <ListVideo className="h-4 w-4" />
            {t('playlist.title')}
          </TabsTrigger>
        </TabsList>

        {/* Single Video Download Tab */}
        <TabsContent value="single" className="space-y-6">
          {/* URL Input Card */}
          {!videoInfo && (
            <Card>
              <CardHeader>
                <CardTitle>{t('download.enterUrl')}</CardTitle>
                <CardDescription>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>{t('sites.homeInlineDescription', { sites: inlinePreviewSites })}</span>
                    <Button
                      type="button"
                      variant="link"
                      className="px-0"
                      onClick={() => onOpenSupportedSites?.()}
                    >
                      {t('sites.viewAll')}
                    </Button>
                  </div>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      ref={inputRef}
                      placeholder={t('download.urlPlaceholder')}
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="pr-10"
                      disabled={loading}
                    />
                    {loading && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <Button onClick={handlePasteUrl} variant="outline" disabled={loading}>
                    {t('download.paste')}
                  </Button>
                  {settings.oneClickDownload ? (
                    <Button onClick={handleOneClickDownload} disabled={loading || !url.trim()}>
                      {loading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t('download.loading')}
                        </>
                      ) : (
                        <>
                          <Download className="mr-2 h-4 w-4" />
                          {t('download.oneClickDownloadNow')}
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button onClick={handleFetchVideo} disabled={loading || !url.trim()}>
                      {loading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t('download.loading')}
                        </>
                      ) : (
                        <>
                          <Search className="mr-2 h-4 w-4" />
                          {t('download.fetch')}
                        </>
                      )}
                    </Button>
                  )}
                </div>

                {/* One-Click Download Info */}
                {settings.oneClickDownload && (
                  <div className="rounded-lg bg-blue-50 dark:bg-blue-900/10 p-4">
                    <div className="flex items-start gap-3">
                      <Download className="h-5 w-5 text-blue-600 mt-0.5 dark:text-blue-400" />
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                          {t('download.oneClickDownload')}
                        </p>
                        <p className="text-sm text-blue-700">
                          {t('download.oneClickDownloadDescription')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Error Display */}
                {error && (
                  <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                      <div className="flex-1 space-y-2">
                        <p className="text-sm font-medium text-destructive">
                          {t('errors.fetchInfoFailed')}
                        </p>
                        <p className="text-sm text-muted-foreground">{error}</p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Video Info and Download Options */}
          {videoInfo && !loading && <VideoInfoCard videoInfo={videoInfo} />}
        </TabsContent>

        {/* Playlist Download Tab */}
        <TabsContent value="playlist" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('playlist.enterPlaylistUrl')}</CardTitle>
              <CardDescription>{t('playlist.playlistUrlDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor={playlistUrlId}>{t('playlist.linkLabel')}</Label>
                <div className="flex gap-2">
                  <Input
                    id={playlistUrlId}
                    placeholder="https://www.youtube.com/playlist?list=..."
                    value={playlistUrl}
                    onChange={(e) => {
                      setPlaylistUrl(e.target.value)
                      setPlaylistInfo(null)
                      setPlaylistPreviewError(null)
                    }}
                    className="flex-1"
                    disabled={playlistBusy}
                  />
                  <Button
                    onClick={handlePastePlaylistUrl}
                    variant="outline"
                    disabled={playlistBusy}
                  >
                    {t('download.paste')}
                  </Button>
                </div>
              </div>

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
                  <Label className="text-muted-foreground">{t('playlist.range')}</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      placeholder={t('playlist.startIndex')}
                      value={startIndex}
                      onChange={(e) => setStartIndex(e.target.value)}
                      min="1"
                      disabled={playlistBusy}
                    />
                    <Input
                      type="number"
                      placeholder={t('playlist.endIndex')}
                      value={endIndex}
                      onChange={(e) => setEndIndex(e.target.value)}
                      min="1"
                      disabled={playlistBusy}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  onClick={handlePreviewPlaylist}
                  variant="outline"
                  className="w-full sm:w-auto"
                  disabled={playlistBusy || !playlistUrl.trim()}
                >
                  {playlistPreviewLoading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      {t('download.loading')}
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-5 w-5" />
                      {t('playlist.previewButton')}
                    </>
                  )}
                </Button>
                {playlistInfo && (
                  <Button
                    onClick={handleDownloadPlaylist}
                    className="w-full sm:flex-1"
                    size="lg"
                    disabled={playlistDownloadLoading || !playlistUrl.trim()}
                  >
                    {playlistDownloadLoading ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        {t('download.loading')}
                      </>
                    ) : (
                      t('playlist.downloadPlaylist')
                    )}
                  </Button>
                )}
              </div>

              {playlistUrl.trim() && !playlistInfo && !playlistPreviewError && !playlistBusy && (
                <p className="text-xs text-muted-foreground">{t('playlist.previewRequired')}</p>
              )}

              {playlistPreviewError && (
                <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                  {playlistPreviewError}
                </div>
              )}
            </CardContent>
          </Card>
          {playlistInfo && (
            <PlaylistPreviewCard
              playlist={playlistInfo}
              entries={selectedPlaylistEntries}
              onClear={handleClearPlaylistPreview}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Unified Download History */}
      <UnifiedDownloadHistory />
    </div>
  )
}
