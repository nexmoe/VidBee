import { ImageWithPlaceholder } from '@renderer/components/ui/image-with-placeholder'
import { Label } from '@renderer/components/ui/label'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { ExternalLink } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { VideoInfo } from '../../../../shared/types'
import { useCachedThumbnail } from '../../hooks/use-cached-thumbnail'
import { FormatSelector } from './FormatSelector'

const VideoInfoSkeleton = () => (
  <div className="flex flex-col w-full flex-1 h-full min-h-0">
    {/* Header Info Skeleton */}
    <div className="flex gap-4 shrink-0 -mx-6 px-6 pb-4 shadow-sm animate-pulse">
      <div className="shrink-0 w-[96px] aspect-video rounded-md bg-muted" />
      <div className="flex-1 min-w-0 py-1 flex flex-col justify-between">
        <div className="space-y-2">
          <div className="h-4 w-3/4 rounded bg-muted" />
          <div className="h-4 w-1/2 rounded bg-muted/70" />
        </div>
        <div className="h-3 w-1/3 rounded bg-muted/70" />
      </div>
    </div>
  </div>
)

export interface VideoInfoCardState {
  title: string
  activeTab: 'video' | 'audio'
  selectedVideoFormat: string
  selectedAudioFormat: string
  customDownloadPath: string
  selectedContainer?: string
  selectedCodec?: string
  selectedFps?: string
}

interface VideoInfoCardProps {
  videoInfo: VideoInfo | null
  loading?: boolean
  state: VideoInfoCardState
  onStateChange: (state: Partial<VideoInfoCardState>) => void
  onTabChange: (tab: 'video' | 'audio') => void
}

function formatDuration(seconds?: number): string {
  if (!seconds) return '00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

function getCodecShortName(codec?: string): string {
  if (!codec || codec === 'none') return 'Unknown'
  return codec.split('.')[0].toUpperCase()
}

export function VideoInfoCard({
  videoInfo,
  loading = false,
  state,
  onStateChange,
  onTabChange
}: VideoInfoCardProps) {
  const { t } = useTranslation()
  const cachedThumbnail = useCachedThumbnail(videoInfo?.thumbnail)

  const { title, activeTab, selectedContainer, selectedCodec, selectedFps } = state

  // Get unique containers based on activeTab
  const containers = useMemo(() => {
    if (!videoInfo?.formats) return []
    const relevantFormats = videoInfo.formats.filter((f) => {
      if (activeTab === 'video') {
        // In video mode, we want formats with video codec
        return f.vcodec && f.vcodec !== 'none'
      } else {
        // In audio mode, we only want audio-only formats (no video)
        return (
          f.acodec &&
          f.acodec !== 'none' &&
          (f.video_ext === 'none' || !f.video_ext || !f.vcodec || f.vcodec === 'none')
        )
      }
    })
    const exts = new Set(relevantFormats.map((f) => f.ext))
    return Array.from(exts).sort()
  }, [videoInfo?.formats, activeTab])

  // Set default container if not set or if current container is not in the list
  useEffect(() => {
    if (containers.length === 0) return undefined

    // Reset container if it's not in the current containers list (e.g., after tab switch)
    if (selectedContainer && !containers.includes(selectedContainer)) {
      let defaultContainer: string
      if (activeTab === 'video') {
        defaultContainer = containers.includes('mp4') ? 'mp4' : containers[0]
      } else {
        defaultContainer = containers.includes('m4a')
          ? 'm4a'
          : containers.includes('mp3')
            ? 'mp3'
            : containers[0]
      }
      const timer = setTimeout(() => {
        onStateChange({ selectedContainer: defaultContainer, selectedCodec: 'auto' })
      }, 0)
      return () => clearTimeout(timer)
    }

    // Set default container if not set
    if (!selectedContainer) {
      let defaultContainer: string
      if (activeTab === 'video') {
        defaultContainer = containers.includes('mp4') ? 'mp4' : containers[0]
      } else {
        defaultContainer = containers.includes('m4a')
          ? 'm4a'
          : containers.includes('mp3')
            ? 'mp3'
            : containers[0]
      }
      const timer = setTimeout(() => {
        onStateChange({ selectedContainer: defaultContainer })
      }, 0)
      return () => clearTimeout(timer)
    }

    return undefined
  }, [containers, selectedContainer, activeTab, onStateChange])

  // Step 1: Filter formats based on activeTab and selected container
  const formatsByContainer = useMemo(() => {
    if (!videoInfo?.formats) return []

    // First filter by activeTab type
    let filteredByType = videoInfo.formats.filter((f) => {
      if (activeTab === 'video') {
        // For video, only formats with video codec
        return f.vcodec && f.vcodec !== 'none'
      } else {
        // For audio, only audio-only formats (no video)
        return (
          f.acodec &&
          f.acodec !== 'none' &&
          (f.video_ext === 'none' || !f.video_ext || !f.vcodec || f.vcodec === 'none')
        )
      }
    })

    // Then filter by selected container if one is selected
    if (selectedContainer) {
      filteredByType = filteredByType.filter((f) => f.ext === selectedContainer)
    }

    return filteredByType
  }, [videoInfo?.formats, selectedContainer, activeTab])

  // Get unique Codecs from formatsByContainer based on activeTab
  // This should only show codecs that exist in the filtered format list
  const codecs = useMemo(() => {
    if (formatsByContainer.length === 0) return []

    const SetVals = new Set<string>()
    formatsByContainer.forEach((f) => {
      if (activeTab === 'video') {
        // For video, only get video codecs from formats that have video
        const c = f.vcodec
        if (c && c !== 'none') {
          SetVals.add(getCodecShortName(c))
        }
      } else {
        // For audio, only get audio codecs from formats that have audio
        const c = f.acodec
        if (c && c !== 'none') {
          SetVals.add(getCodecShortName(c))
        }
      }
    })
    return Array.from(SetVals).sort()
  }, [formatsByContainer, activeTab])

  // Reset codec if it's not in the current codecs list (e.g., after tab or container switch)
  useEffect(() => {
    if (codecs.length === 0) return undefined
    if (selectedCodec && selectedCodec !== 'auto' && !codecs.includes(selectedCodec)) {
      const timer = setTimeout(() => {
        onStateChange({ selectedCodec: 'auto' })
      }, 0)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [codecs, selectedCodec, onStateChange])

  // Step 2: Filter formats by selected Codec based on activeTab
  const formatsByCodec = useMemo(() => {
    if (!selectedCodec || selectedCodec === 'auto') return formatsByContainer
    return formatsByContainer.filter((f) => {
      if (activeTab === 'video') {
        // For video, filter by video codec
        const c = f.vcodec
        return c && c !== 'none' && getCodecShortName(c) === selectedCodec
      } else {
        // For audio, filter by audio codec
        const c = f.acodec
        return c && c !== 'none' && getCodecShortName(c) === selectedCodec
      }
    })
  }, [formatsByContainer, selectedCodec, activeTab])

  // Get unique Framerates from formatsByCodec (only for video)
  const framerates = useMemo(() => {
    if (activeTab !== 'video') return []
    const SetVals = new Set<number>()
    formatsByCodec.forEach((f) => {
      if (f.fps) SetVals.add(f.fps)
    })
    return Array.from(SetVals).sort((a, b) => b - a)
  }, [formatsByCodec, activeTab])

  // Step 3: Filter formats by selected FPS
  const filteredFormats = useMemo(() => {
    let res = formatsByCodec
    if (activeTab === 'video' && selectedFps && selectedFps !== 'highest') {
      res = res.filter((f) => f.fps === Number(selectedFps))
    }
    return res
  }, [formatsByCodec, selectedFps, activeTab])

  if (loading || !videoInfo) {
    return <VideoInfoSkeleton />
  }

  return (
    <div className="flex flex-col w-full flex-1 h-full min-h-0">
      {/* Header Info */}
      <div className="flex gap-4 shrink-0 -mx-6 px-6 pb-4 shadow-sm">
        <div className="shrink-0 w-[96px] aspect-video rounded-md overflow-hidden bg-muted relative">
          <ImageWithPlaceholder
            src={cachedThumbnail}
            alt={title}
            className="w-full h-full object-cover"
          />
          <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">
            {formatDuration(videoInfo.duration)}
          </div>
        </div>
        <div className="flex-1 min-w-0 py-1 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium text-sm leading-snug line-clamp-2">{title}</h3>
            <a
              href={videoInfo.webpage_url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-primary relative top-0.5"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
          <div className="text-xs text-muted-foreground">{videoInfo.uploader}</div>
        </div>
      </div>

      {/* Controls Area */}
      <ScrollArea className="bg-muted/30 overflow-y-auto max-h-68 -mx-6 flex-1 min-h-0">
        <div className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">
                {t('download.download') || 'Download'}
              </Label>
              <Select
                value={activeTab}
                onValueChange={(v) => {
                  onTabChange(v as 'video' | 'audio')
                  onStateChange({ activeTab: v as 'video' | 'audio' })
                }}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="video">{t('download.video')}</SelectItem>
                  <SelectItem value="audio">{t('download.audio')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">
                {t('download.container') || 'Container'}
              </Label>
              <Select
                value={selectedContainer || ''}
                onValueChange={(v) => {
                  onStateChange({ selectedContainer: v })
                }}
                disabled={containers.length === 0}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Select container" />
                </SelectTrigger>
                <SelectContent>
                  {containers.map((ext) => (
                    <SelectItem key={ext} value={ext}>
                      {ext.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Advanced Filters */}
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Codec</span>
              <Select
                value={selectedCodec || 'auto'}
                onValueChange={(v) => onStateChange({ selectedCodec: v })}
                disabled={codecs.length === 0}
              >
                <SelectTrigger className="h-7 w-auto min-w-[70px] text-xs bg-transparent border-none shadow-none focus:ring-0 px-0 gap-1">
                  <SelectValue placeholder="Auto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  {codecs.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {activeTab === 'video' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Frame Rate</span>
                <Select
                  value={selectedFps || 'highest'}
                  onValueChange={(v) => onStateChange({ selectedFps: v })}
                  disabled={framerates.length === 0}
                >
                  <SelectTrigger className="h-7 w-auto min-w-[80px] text-xs bg-transparent border-none shadow-none focus:ring-0 px-0 gap-1">
                    <SelectValue placeholder="Highest" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="highest">Highest</SelectItem>
                    {framerates.map((fps) => (
                      <SelectItem key={fps} value={String(fps)}>
                        {fps}fps
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* List */}
          <div className="mt-4 min-h-[200px]">
            <FormatSelector
              formats={filteredFormats}
              type={activeTab}
              codec={selectedCodec}
              onVideoFormatChange={(format) => onStateChange({ selectedVideoFormat: format })}
              onAudioFormatChange={(format) => onStateChange({ selectedAudioFormat: format })}
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
