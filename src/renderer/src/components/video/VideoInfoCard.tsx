import { Badge } from '@renderer/components/ui/badge'
import { Card, CardContent, CardHeader } from '@renderer/components/ui/card'
import { ImageWithPlaceholder } from '@renderer/components/ui/image-with-placeholder'
import { Separator } from '@renderer/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'

import { Clock, Eye, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { VideoInfo } from '../../../../shared/types'
import { useCachedThumbnail } from '../../hooks/use-cached-thumbnail'
import { AudioExtractor, type AudioExtractorState } from './AudioExtractor'
import { FormatSelector } from './FormatSelector'

export interface VideoInfoCardState {
  title: string
  activeTab: 'video' | 'audio'
  selectedVideoFormat: string
  selectedAudioForVideo: string
  selectedAudioFormat: string
  startTime: string
  endTime: string
  downloadSubs: boolean
  customDownloadPath: string
  audioExtractor: AudioExtractorState
}

interface VideoInfoCardProps {
  videoInfo: VideoInfo
  state: VideoInfoCardState
  onStateChange: (state: Partial<VideoInfoCardState>) => void
  onTabChange: (tab: 'video' | 'audio') => void
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

export function VideoInfoCard({
  videoInfo,
  state,
  onStateChange,
  onTabChange
}: VideoInfoCardProps) {
  const { t } = useTranslation()
  const cachedThumbnail = useCachedThumbnail(videoInfo.thumbnail)

  const { title, activeTab } = state

  return (
    <div>
      <Card className="overflow-hidden border shadow-sm">
        <CardHeader className="p-3">
          <div className="flex gap-3">
            {/* Thumbnail */}
            <div className="shrink-0">
              <div className="relative overflow-hidden rounded-md aspect-video w-[120px] sm:w-[140px] bg-muted">
                <ImageWithPlaceholder
                  src={cachedThumbnail}
                  alt={title}
                  className="w-full h-full object-cover"
                  fallbackIcon={<Play className="h-6 w-6 opacity-20" />}
                />
              </div>
            </div>

            {/* Video Metadata */}
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-wrap gap-1.5 items-center">
                <Badge
                  variant="outline"
                  className="text-[10px] font-semibold bg-muted/50 px-1.5 py-0.5"
                >
                  {videoInfo.extractor_key || t('download.videoInfo')}
                </Badge>
                {videoInfo.duration && (
                  <Badge variant="secondary" className="gap-1 px-1.5 py-0.5 text-[10px]">
                    <Clock className="h-2.5 w-2.5" />
                    <span>{formatDuration(videoInfo.duration)}</span>
                  </Badge>
                )}
                {videoInfo.view_count && (
                  <Badge variant="secondary" className="gap-1 px-1.5 py-0.5 text-[10px]">
                    <Eye className="h-2.5 w-2.5" />
                    <span>{formatViews(videoInfo.view_count)}</span>
                  </Badge>
                )}
              </div>

              <div className="space-y-1">
                <p className="font-semibold text-sm leading-tight line-clamp-2">{title}</p>
                {videoInfo.uploader && (
                  <p className="text-[10px] text-muted-foreground truncate">{videoInfo.uploader}</p>
                )}
              </div>
            </div>
          </div>
        </CardHeader>

        <Separator />

        <CardContent className="p-3 pt-3">
          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              onTabChange(v as 'video' | 'audio')
              onStateChange({ activeTab: v as 'video' | 'audio' })
            }}
            className="w-full"
          >
            <TabsList className="grid grid-cols-2 w-full mb-3 h-8">
              <TabsTrigger value="video" className="text-xs">
                {t('download.video')}
              </TabsTrigger>
              <TabsTrigger value="audio" className="text-xs">
                {t('download.audio')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="video" className="space-y-3 mt-0">
              <FormatSelector
                formats={videoInfo.formats || []}
                type="video"
                onVideoFormatChange={(format) => onStateChange({ selectedVideoFormat: format })}
                onAudioFormatChange={(format) => onStateChange({ selectedAudioForVideo: format })}
              />
            </TabsContent>

            <TabsContent value="audio" className="space-y-3 mt-0">
              <FormatSelector
                formats={videoInfo.formats || []}
                type="audio"
                onAudioFormatChange={(format) => onStateChange({ selectedAudioFormat: format })}
              />

              <AudioExtractor
                videoInfo={videoInfo}
                state={state.audioExtractor}
                onStateChange={(updates) =>
                  onStateChange({
                    audioExtractor: { ...state.audioExtractor, ...updates }
                  })
                }
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
