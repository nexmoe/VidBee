import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { ImageWithPlaceholder } from '@renderer/components/ui/image-with-placeholder'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Separator } from '@renderer/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { useSetAtom } from 'jotai'
import { ArrowLeft, Clock, Download as DownloadIcon, Eye, Play } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { VideoInfo } from '../../../../shared/types'
import { useCachedThumbnail } from '../../hooks/use-cached-thumbnail'
import { ipcServices } from '../../lib/ipc'
import { addDownloadAtom } from '../../store/downloads'
import { clearVideoInfoAtom } from '../../store/video'
import { AdvancedOptions } from './AdvancedOptions'
import { AudioExtractor } from './AudioExtractor'
import { FormatSelector } from './FormatSelector'

interface VideoInfoCardProps {
  videoInfo: VideoInfo
}

function formatDuration(seconds?: number): string {
  if (!seconds) return 'Unknown'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatViews(views?: number): string {
  if (!views) return 'Unknown'
  if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`
  if (views >= 1000) return `${(views / 1000).toFixed(1)}K`
  return views.toString()
}

export function VideoInfoCard({ videoInfo }: VideoInfoCardProps) {
  const { t } = useTranslation()
  const clearVideoInfo = useSetAtom(clearVideoInfoAtom)
  const addDownload = useSetAtom(addDownloadAtom)
  const titleId = useId()
  const cachedThumbnail = useCachedThumbnail(videoInfo.thumbnail)

  const [activeTab, setActiveTab] = useState<'video' | 'audio'>('video')
  const [title, setTitle] = useState(videoInfo.title)
  const [selectedVideoFormat, setSelectedVideoFormat] = useState('')
  const [selectedAudioForVideo, setSelectedAudioForVideo] = useState('')
  const [selectedAudioFormat, setSelectedAudioFormat] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [downloadSubs, setDownloadSubs] = useState(false)
  const [customDownloadPath, setCustomDownloadPath] = useState('')

  useEffect(() => {
    setCustomDownloadPath('')
  }, [videoInfo.id])

  const handleDownload = async (type: 'video' | 'audio' | 'extract') => {
    const id = `download_${Date.now()}_${Math.random().toString(36).substring(7)}`

    const downloadItem = {
      id,
      url: videoInfo.webpage_url || '',
      title,
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
      format: type === 'video' ? selectedVideoFormat : selectedAudioFormat,
      audioFormat: type === 'video' ? selectedAudioForVideo : undefined,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      downloadSubs,
      customDownloadPath: customDownloadPath.trim() || undefined
    }

    addDownload(downloadItem)

    try {
      await ipcServices.download.startDownload(id, options)

      // Update the download info in the main process queue
      await ipcServices.download.updateDownloadInfo(id, {
        title,
        thumbnail: videoInfo.thumbnail,
        duration: videoInfo.duration,
        description: videoInfo.description,
        channel: videoInfo.extractor_key,
        uploader: videoInfo.extractor_key,
        createdAt: Date.now()
      })

      toast.success(t('notifications.downloadStarted'))
      clearVideoInfo()
    } catch (error) {
      console.error('Failed to start download:', error)
      toast.error(t('notifications.downloadFailed'))
    }
  }

  return (
    <div className="space-y-5">
      <Button variant="ghost" onClick={() => clearVideoInfo()} className="gap-2 -ml-2" size="sm">
        <ArrowLeft className="h-4 w-4" />
        {t('download.back')}
      </Button>

      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row gap-6">
            {/* Thumbnail */}
            <div className="shrink-0">
              <ImageWithPlaceholder
                src={cachedThumbnail}
                alt={title}
                className="w-full md:w-80 rounded-lg aspect-video object-cover shadow-sm"
                fallbackIcon={<Play className="h-12 w-12" />}
              />
            </div>

            {/* Video Metadata */}
            <div className="flex-1 space-y-4 min-w-0">
              <div className="space-y-3">
                <CardTitle className="text-2xl leading-tight">{t('download.videoInfo')}</CardTitle>
                <CardDescription className="flex flex-wrap gap-2 items-center">
                  {videoInfo.duration && (
                    <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
                      <Clock className="h-3.5 w-3.5" />
                      <span>{formatDuration(videoInfo.duration)}</span>
                    </Badge>
                  )}
                  {videoInfo.view_count && (
                    <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
                      <Eye className="h-3.5 w-3.5" />
                      <span>{formatViews(videoInfo.view_count)}</span>
                    </Badge>
                  )}
                  {videoInfo.uploader && (
                    <Badge variant="outline" className="px-2.5 py-1">
                      {videoInfo.uploader}
                    </Badge>
                  )}
                </CardDescription>
              </div>

              <div className="space-y-2.5">
                <Label htmlFor={titleId} className="text-sm font-semibold">
                  {t('download.title')}
                </Label>
                <Input
                  id={titleId}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="font-medium h-10"
                />
              </div>
            </div>
          </div>
        </CardHeader>

        <Separator />

        <CardContent className="pt-6 pb-6">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'video' | 'audio')}>
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="video" className="text-sm font-medium">
                {t('download.video')}
              </TabsTrigger>
              <TabsTrigger value="audio" className="text-sm font-medium">
                {t('download.audio')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="video" className="space-y-5 mt-0">
              <FormatSelector
                formats={videoInfo.formats || []}
                type="video"
                onVideoFormatChange={setSelectedVideoFormat}
                onAudioFormatChange={setSelectedAudioForVideo}
              />

              <AdvancedOptions
                startTime={startTime}
                endTime={endTime}
                downloadSubs={downloadSubs}
                onStartTimeChange={setStartTime}
                onEndTimeChange={setEndTime}
                onDownloadSubsChange={setDownloadSubs}
                customDownloadPath={customDownloadPath}
                onCustomDownloadPathChange={setCustomDownloadPath}
              />

              <Button
                onClick={() => handleDownload('video')}
                className="w-full"
                size="lg"
                variant="default"
              >
                <DownloadIcon className="mr-2 h-5 w-5" />
                {t('download.downloadVideo')}
              </Button>
            </TabsContent>

            <TabsContent value="audio" className="space-y-5 mt-0">
              <FormatSelector
                formats={videoInfo.formats || []}
                type="audio"
                onAudioFormatChange={setSelectedAudioFormat}
              />

              <AudioExtractor videoInfo={videoInfo} onExtract={handleDownload} />

              <AdvancedOptions
                startTime={startTime}
                endTime={endTime}
                downloadSubs={downloadSubs}
                onStartTimeChange={setStartTime}
                onEndTimeChange={setEndTime}
                onDownloadSubsChange={setDownloadSubs}
                customDownloadPath={customDownloadPath}
                onCustomDownloadPathChange={setCustomDownloadPath}
              />

              <Button
                onClick={() => handleDownload('audio')}
                className="w-full"
                size="lg"
                variant="default"
              >
                <DownloadIcon className="mr-2 h-5 w-5" />
                {t('download.downloadAudio')}
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
