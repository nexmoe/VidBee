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
import { Tabs, TabsContent } from '@renderer/components/ui/tabs'
import { popularSites } from '@renderer/data/popularSites'
import type { AppSettings, OneClickQualityPreset } from '@shared/types'
import { useAtom, useSetAtom } from 'jotai'
import { AlertCircle, Download, Loader2, Search } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { UnifiedDownloadHistory } from '../components/download/UnifiedDownloadHistory'
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
  const [playlistLoading, setPlaylistLoading] = useState(false)
  const [downloadType, setDownloadType] = useState<'video' | 'audio'>('video')
  const [startIndex, setStartIndex] = useState('1')
  const [endIndex, setEndIndex] = useState('')

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
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        toast.error(t('errors.clipboardEmpty'))
        return
      }
      setPlaylistUrl(text.trim())
    } catch (error) {
      console.error('Failed to paste URL:', error)
      toast.error(t('errors.pasteFromClipboard'))
    }
  }, [t])

  const handleDownloadPlaylist = useCallback(async () => {
    if (!playlistUrl.trim()) {
      toast.error(t('errors.emptyUrl'))
      return
    }

    setPlaylistLoading(true)
    try {
      // Get playlist info first to show user what will be downloaded
      const playlistInfo = await ipcServices.download.getPlaylistInfo(playlistUrl)

      toast.success(t('playlist.foundVideos', { count: playlistInfo.entryCount }))

      // Build format preference based on settings
      const format =
        downloadType === 'video'
          ? buildVideoFormatPreference(settings)
          : buildAudioFormatPreference(settings)

      // Start playlist download
      const downloadIds = await ipcServices.download.startPlaylistDownload({
        url: playlistUrl.trim(),
        type: downloadType,
        format,
        startIndex: parseInt(startIndex, 10) || 1,
        endIndex: endIndex ? parseInt(endIndex, 10) : undefined
      })

      // Add all downloads to the renderer state
      for (const id of downloadIds) {
        const downloadItem = {
          id,
          url: playlistUrl.trim(),
          title: t('download.fetchingVideoInfo'),
          type: downloadType,
          status: 'pending' as const,
          progress: { percent: 0 },
          createdAt: Date.now()
        }
        addDownload(downloadItem)
      }

      toast.success(t('playlist.downloadStarted', { count: downloadIds.length }))
      setPlaylistUrl('') // Clear the URL after starting download
    } catch (error) {
      console.error('Failed to start playlist download:', error)
      toast.error(t('playlist.downloadFailed'))
    } finally {
      setPlaylistLoading(false)
    }
  }, [playlistUrl, downloadType, startIndex, endIndex, settings, addDownload, t])

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
        {/* <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="single" className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            {t('download.singleVideo')}
          </TabsTrigger>
          <TabsTrigger value="playlist" className="flex items-center gap-2">
            <ListVideo className="h-4 w-4" />
            {t('playlist.title')}
          </TabsTrigger>
        </TabsList> */}

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
                    onChange={(e) => setPlaylistUrl(e.target.value)}
                    className="flex-1"
                    disabled={playlistLoading}
                  />
                  <Button
                    onClick={handlePastePlaylistUrl}
                    variant="outline"
                    disabled={playlistLoading}
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
                    disabled={playlistLoading}
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
                      disabled={playlistLoading}
                    />
                    <Input
                      type="number"
                      placeholder={t('playlist.endIndex')}
                      value={endIndex}
                      onChange={(e) => setEndIndex(e.target.value)}
                      min="1"
                      disabled={playlistLoading}
                    />
                  </div>
                </div>
              </div>

              <Button
                onClick={handleDownloadPlaylist}
                className="w-full"
                size="lg"
                disabled={playlistLoading || !playlistUrl.trim()}
              >
                {playlistLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    {t('download.loading')}
                  </>
                ) : (
                  t('playlist.downloadPlaylist')
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Unified Download History */}
      <UnifiedDownloadHistory />
    </div>
  )
}
