import { Button } from '@renderer/components/ui/button'
import { ImageWithPlaceholder } from '@renderer/components/ui/image-with-placeholder'
import { Label } from '@renderer/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Separator } from '@renderer/components/ui/separator'
import { cn } from '@renderer/lib/utils'
import type { OneClickQualityPreset, VideoFormat, VideoInfo } from '@shared/types'
import { useAtom } from 'jotai'
import { AlertCircle, ExternalLink, Loader2, Settings2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DOWNLOAD_FEEDBACK_ISSUE_TITLE,
  FeedbackLinkButtons
} from '../feedback/FeedbackLinks'
import { useCachedThumbnail } from '../../hooks/use-cached-thumbnail'
import { settingsAtom } from '../../store/settings'

export interface SingleVideoState {
  title: string
  activeTab: 'video' | 'audio'
  selectedVideoFormat: string
  selectedAudioFormat: string
  customDownloadPath: string
  selectedContainer?: string
  selectedCodec?: string
  selectedFps?: string
}

interface SingleVideoDownloadProps {
  loading: boolean
  error: string | null
  videoInfo: VideoInfo | null
  state: SingleVideoState
  feedbackSourceUrl?: string | null
  ytDlpCommand?: string
  onStateChange: (state: Partial<SingleVideoState>) => void
}

const qualityPresetToVideoHeight: Record<OneClickQualityPreset, number | null> = {
  best: null,
  good: 1080,
  normal: 720,
  bad: 480,
  worst: 360
}

const formatDuration = (seconds?: number): string => {
  if (!seconds) return '00:00'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

const getCodecShortName = (codec?: string): string => {
  if (!codec || codec === 'none') return 'Unknown'
  return codec.split('.')[0].toUpperCase()
}

const filterFormatsByType = (
  formats: VideoInfo['formats'],
  activeTab: 'video' | 'audio'
): VideoInfo['formats'] => {
  if (!formats) return []

  return formats.filter((format) => {
    if (activeTab === 'video') {
      return format.vcodec && format.vcodec !== 'none'
    }

    return (
      format.acodec &&
      format.acodec !== 'none' &&
      (format.video_ext === 'none' ||
        !format.video_ext ||
        !format.vcodec ||
        format.vcodec === 'none')
    )
  })
}

interface FormatListProps {
  formats: VideoFormat[]
  type: 'video' | 'audio'
  codec?: string
  selectedFormat: string
  onFormatChange: (formatId: string) => void
}

const FormatList = ({ formats, type, codec, selectedFormat, onFormatChange }: FormatListProps) => {
  const { t } = useTranslation()
  const [settings] = useAtom(settingsAtom)
  const [videoFormats, setVideoFormats] = useState<VideoFormat[]>([])
  const [audioFormats, setAudioFormats] = useState<VideoFormat[]>([])

  const getFileSize = useCallback((format: VideoFormat): number => {
    return format.filesize ?? format.filesize_approx ?? 0
  }, [])

  const sortVideoFormatsByQuality = useCallback(
    (a: VideoFormat, b: VideoFormat) => {
      const aHeight = a.height ?? 0
      const bHeight = b.height ?? 0
      if (aHeight !== bHeight) {
        return bHeight - aHeight
      }
      const aFps = a.fps ?? 0
      const bFps = b.fps ?? 0
      if (aFps !== bFps) {
        return bFps - aFps
      }
      const aHasSize = !!(a.filesize || a.filesize_approx)
      const bHasSize = !!(b.filesize || b.filesize_approx)
      if (aHasSize !== bHasSize) {
        return bHasSize ? 1 : -1
      }
      return getFileSize(b) - getFileSize(a)
    },
    [getFileSize]
  )

  const sortAudioFormatsByQuality = useCallback(
    (a: VideoFormat, b: VideoFormat) => {
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
      return getFileSize(b) - getFileSize(a)
    },
    [getFileSize]
  )

  const pickVideoFormatForPreset = useCallback(
    (presetFormats: VideoFormat[], preset: OneClickQualityPreset): VideoFormat | null => {
      if (presetFormats.length === 0) {
        return null
      }

      const heightLimit = qualityPresetToVideoHeight[preset]
      const sorted = [...presetFormats].sort(sortVideoFormatsByQuality)

      if (preset === 'worst') {
        return sorted[sorted.length - 1] ?? sorted[0]
      }

      if (!heightLimit) {
        return sorted[0]
      }

      const matchingLimit = sorted.find((format) => {
        if (!format.height) return false
        return format.height <= heightLimit
      })

      return matchingLimit ?? sorted[0]
    },
    [sortVideoFormatsByQuality]
  )

  useEffect(() => {
    const isVideoFormat = (format: VideoFormat) =>
      format.video_ext !== 'none' && format.vcodec && format.vcodec !== 'none'
    const isAudioFormat = (format: VideoFormat) =>
      format.acodec &&
      format.acodec !== 'none' &&
      (format.video_ext === 'none' ||
        !format.video_ext ||
        !format.vcodec ||
        format.vcodec === 'none')

    const videos = formats.filter(isVideoFormat)
    const audios = formats.filter(isAudioFormat)

    const groupedByHeight = new Map<number, VideoFormat[]>()
    videos.forEach((format) => {
      const height = format.height ?? 0
      const existing = groupedByHeight.get(height) || []
      existing.push(format)
      groupedByHeight.set(height, existing)
    })

    const finalVideos = Array.from(groupedByHeight.values()).map((group) => {
      return group.sort((a, b) => getFileSize(b) - getFileSize(a))[0]
    })

    let finalAudios = audios

    if (codec === 'auto' && type === 'audio') {
      const groupedByQuality = new Map<string, VideoFormat[]>()
      audios.forEach((format) => {
        const qualityKey = format.tbr
          ? `tbr_${format.tbr}`
          : format.quality
            ? `quality_${format.quality}`
            : 'unknown'
        const existing = groupedByQuality.get(qualityKey) || []
        existing.push(format)
        groupedByQuality.set(qualityKey, existing)
      })

      finalAudios = Array.from(groupedByQuality.values()).map((group) => {
        return group.sort((a, b) => getFileSize(b) - getFileSize(a))[0]
      })
    }

    finalVideos.sort(sortVideoFormatsByQuality)
    finalAudios.sort(sortAudioFormatsByQuality)

    setVideoFormats(finalVideos)
    setAudioFormats(finalAudios)

    if (type === 'video') {
      const videosWithAudio = finalVideos.filter(
        (format) => format.acodec && format.acodec !== 'none'
      )
      const autoVideos =
        finalAudios.length > 0
          ? finalVideos
          : videosWithAudio.length > 0
            ? videosWithAudio
            : finalVideos

      const hasSelectedVideo = finalVideos.some((format) => format.format_id === selectedFormat)
      if (autoVideos.length > 0 && (!selectedFormat || !hasSelectedVideo)) {
        const preferred = pickVideoFormatForPreset(autoVideos, settings.oneClickQuality)
        if (preferred) {
          onFormatChange(preferred.format_id)
        }
      }
    } else {
      const hasSelectedAudio = finalAudios.some((format) => format.format_id === selectedFormat)
      if (finalAudios.length > 0 && (!selectedFormat || !hasSelectedAudio)) {
        const best = finalAudios[0]
        onFormatChange(best.format_id)
      }
    }
  }, [
    formats,
    settings.oneClickQuality,
    type,
    selectedFormat,
    onFormatChange,
    pickVideoFormatForPreset,
    codec,
    getFileSize,
    sortVideoFormatsByQuality,
    sortAudioFormatsByQuality
  ])

  const formatSize = (bytes?: number) => {
    if (!bytes) return t('download.unknownSize')
    const mb = bytes / 1000000
    return `${mb.toFixed(2)} MB`
  }

  const formatVideoQuality = (format: VideoFormat) => {
    if (format.height) {
      return `${format.height}p${format.fps === 60 ? '60' : ''}`
    }
    if (format.format_note) {
      return format.format_note
    }
    if (typeof format.quality === 'number') {
      return format.quality.toString()
    }
    return t('download.unknownQuality')
  }

  const formatAudioQuality = (format: VideoFormat) => {
    if (format.tbr) {
      return `${Math.round(format.tbr)} kbps`
    }
    if (format.format_note) {
      return format.format_note
    }
    if (typeof format.quality === 'number') {
      return format.quality.toString()
    }
    return t('download.unknownQuality')
  }

  const formatVideoDetail = (format: VideoFormat) => {
    const parts: string[] = []
    parts.push(format.ext.toUpperCase())
    if (format.vcodec) {
      parts.push(format.vcodec.split('.')[0].toUpperCase())
    }
    if (format.acodec && format.acodec !== 'none') {
      parts.push(format.acodec.split('.')[0].toUpperCase())
    }
    return parts.join(' • ')
  }

  const formatAudioDetail = (format: VideoFormat) => {
    const parts: string[] = []
    const ext = format.ext === 'webm' ? 'opus' : format.ext
    parts.push(ext.toUpperCase())
    if (format.acodec) {
      parts.push(format.acodec.split('.')[0].toUpperCase())
    }
    return parts.join(' • ')
  }

  const list = type === 'video' ? videoFormats : audioFormats

  if (list.length === 0) {
    return null
  }

  return (
    <RadioGroup value={selectedFormat} onValueChange={onFormatChange} className="w-full gap-1">
      {list.map((format) => {
        const qualityLabel =
          type === 'video' ? formatVideoQuality(format) : formatAudioQuality(format)
        const detailLabel = type === 'video' ? formatVideoDetail(format) : formatAudioDetail(format)
        const thirdColumnLabel =
          type === 'video'
            ? format.fps
              ? `${format.fps}fps`
              : ''
            : format.acodec
              ? format.acodec.split('.')[0].toUpperCase()
              : ''
        const sizeLabel = formatSize(format.filesize || format.filesize_approx)
        const isSelected = selectedFormat === format.format_id

        return (
          <label
            key={format.format_id}
            htmlFor={`${type}-${format.format_id}`}
            className={cn(
              'relative flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors rounded-md',
              isSelected ? 'bg-primary/10' : 'hover:bg-muted'
            )}
          >
            <RadioGroupItem
              value={format.format_id}
              id={`${type}-${format.format_id}`}
              className="shrink-0 hidden"
            />

            <div className="flex-1 min-w-0 flex items-center gap-4">
              <span
                className={cn('text-sm font-medium w-16 shrink-0', isSelected && 'text-primary')}
              >
                {qualityLabel}
              </span>

              <div className="flex-1 flex items-center gap-2 min-w-0">
                <span className="text-xs text-muted-foreground truncate">{detailLabel}</span>
                {thirdColumnLabel && thirdColumnLabel !== '-' && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded bg-muted text-[10px] font-medium text-muted-foreground">
                    {thirdColumnLabel}
                  </span>
                )}
              </div>

              <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-20 text-right">
                {sizeLabel}
              </span>
            </div>
          </label>
        )
      })}
    </RadioGroup>
  )
}

export function SingleVideoDownload({
  loading,
  error,
  videoInfo,
  state,
  feedbackSourceUrl,
  ytDlpCommand,
  onStateChange
}: SingleVideoDownloadProps) {
  const { t } = useTranslation()
  const cachedThumbnail = useCachedThumbnail(videoInfo?.thumbnail)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const { title, activeTab, selectedContainer, selectedCodec, selectedFps } = state
  const displayTitle = title || videoInfo?.title || t('download.fetchingVideoInfo')

  const relevantFormats = useMemo(() => {
    if (!videoInfo?.formats) return []
    return filterFormatsByType(videoInfo.formats, activeTab)
  }, [videoInfo?.formats, activeTab])

  const containers = useMemo(() => {
    if (relevantFormats.length === 0) return []
    const exts = new Set(relevantFormats.map((format) => format.ext))
    return Array.from(exts).sort()
  }, [relevantFormats])

  useEffect(() => {
    if (containers.length === 0) return undefined

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

  const formatsByContainer = useMemo(() => {
    if (relevantFormats.length === 0) return []

    if (!selectedContainer) {
      return relevantFormats
    }

    return relevantFormats.filter((format) => format.ext === selectedContainer)
  }, [relevantFormats, selectedContainer])

  const codecs = useMemo(() => {
    if (formatsByContainer.length === 0) return []

    const SetVals = new Set<string>()
    formatsByContainer.forEach((format) => {
      if (activeTab === 'video') {
        const c = format.vcodec
        if (c && c !== 'none') {
          SetVals.add(getCodecShortName(c))
        }
      } else {
        const c = format.acodec
        if (c && c !== 'none') {
          SetVals.add(getCodecShortName(c))
        }
      }
    })
    return Array.from(SetVals).sort()
  }, [formatsByContainer, activeTab])

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

  const formatsByCodec = useMemo(() => {
    if (!selectedCodec || selectedCodec === 'auto') return formatsByContainer
    return formatsByContainer.filter((format) => {
      if (activeTab === 'video') {
        const c = format.vcodec
        return c && c !== 'none' && getCodecShortName(c) === selectedCodec
      }
      const c = format.acodec
      return c && c !== 'none' && getCodecShortName(c) === selectedCodec
    })
  }, [formatsByContainer, selectedCodec, activeTab])

  const framerates = useMemo(() => {
    if (activeTab !== 'video') return []
    const SetVals = new Set<number>()
    formatsByCodec.forEach((format) => {
      if (format.fps) SetVals.add(format.fps)
    })
    return Array.from(SetVals).sort((a, b) => b - a)
  }, [formatsByCodec, activeTab])

  const filteredFormats = useMemo(() => {
    let res = formatsByCodec
    if (activeTab === 'video' && selectedFps && selectedFps !== 'highest') {
      res = res.filter((format) => format.fps === Number(selectedFps))
    }
    return res
  }, [formatsByCodec, selectedFps, activeTab])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {loading && !error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 min-h-[200px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t('download.fetchingVideoInfo')}</p>
        </div>
      )}

      {error && (
        <div className="shrink-0 mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1 min-w-0">
              <p className="text-sm font-medium text-destructive">{t('errors.fetchInfoFailed')}</p>
              <p className="text-xs text-muted-foreground/80 break-words">{error}</p>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-medium text-muted-foreground/70">
              {t('download.feedback.title')}
            </span>
            <div className="flex flex-wrap gap-1.5">
              <FeedbackLinkButtons
                error={error}
                sourceUrl={feedbackSourceUrl}
                issueTitle={DOWNLOAD_FEEDBACK_ISSUE_TITLE}
                includeAppInfo
                ytDlpCommand={ytDlpCommand}
                buttonVariant="outline"
                buttonSize="sm"
                buttonClassName="h-5 gap-1 px-1.5 text-[10px]"
                iconClassName="h-2.5 w-2.5"
              />
            </div>
          </div>
        </div>
      )}

      {!loading && videoInfo && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex gap-4 py-4 shrink-0">
            <div className="shrink-0 w-32 relative rounded-md overflow-hidden bg-muted">
              <ImageWithPlaceholder
                src={cachedThumbnail}
                alt={displayTitle}
                className="w-full h-full object-cover aspect-video"
              />
              <div className="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] px-1 rounded">
                {formatDuration(videoInfo.duration)}
              </div>
            </div>

            <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
              <div className="space-y-0.5">
                <h3 className="font-bold text-[13px] leading-tight line-clamp-2">{displayTitle}</h3>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {videoInfo.uploader && (
                    <span className="truncate max-w-[140px] uppercase tracking-wider font-semibold opacity-70">
                      {videoInfo.uploader}
                    </span>
                  )}
                  {videoInfo.webpage_url && (
                    <a
                      href={videoInfo.webpage_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-primary transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex p-0.5 bg-muted rounded-md gap-0.5">
                  <Button
                    variant={activeTab === 'video' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => onStateChange({ activeTab: 'video' })}
                    className={cn(
                      'h-5 px-2 text-[11px] rounded-sm',
                      activeTab === 'video'
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground/60'
                    )}
                  >
                    {t('download.video')}
                  </Button>
                  <Button
                    variant={activeTab === 'audio' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => onStateChange({ activeTab: 'audio' })}
                    className={cn(
                      'h-5 px-2 text-[11px] rounded-sm',
                      activeTab === 'audio'
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground/60'
                    )}
                  >
                    {t('download.audio')}
                  </Button>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className={cn(
                    'h-6 w-6 p-0 rounded-full hover:bg-muted font-normal text-muted-foreground transition-colors',
                    showAdvanced && 'bg-muted text-foreground'
                  )}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div
              className={cn(
                'grid transition-all duration-300 ease-in-out',
                showAdvanced ? 'grid-rows-[1fr] py-3 border-b' : 'grid-rows-[0fr]'
              )}
            >
              <div className="overflow-hidden min-h-0">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5 flex-1 min-w-[120px]">
                    <Label className="text-xs text-muted-foreground font-medium px-0.5">
                      {t('download.container') || 'Format'}
                    </Label>
                    <Select
                      value={selectedContainer || ''}
                      onValueChange={(value) => onStateChange({ selectedContainer: value })}
                      disabled={containers.length <= 1}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Container" />
                      </SelectTrigger>
                      <SelectContent>
                        {containers.map((ext) => (
                          <SelectItem key={ext} value={ext} className="text-xs">
                            {ext.toUpperCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5 flex-1 min-w-[120px]">
                    <Label className="text-xs text-muted-foreground font-medium px-0.5">
                      Codec
                    </Label>
                    <Select
                      value={selectedCodec || 'auto'}
                      onValueChange={(value) => onStateChange({ selectedCodec: value })}
                      disabled={codecs.length <= 1}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Auto" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto" className="text-xs">
                          Auto
                        </SelectItem>
                        {codecs.map((codecName) => (
                          <SelectItem key={codecName} value={codecName} className="text-xs">
                            {codecName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {activeTab === 'video' && (
                    <div className="space-y-1.5 flex-1 min-w-[120px]">
                      <Label className="text-xs text-muted-foreground font-medium px-0.5">
                        Frame Rate
                      </Label>
                      <Select
                        value={selectedFps || 'highest'}
                        onValueChange={(value) => onStateChange({ selectedFps: value })}
                        disabled={framerates.length === 0}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Highest" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="highest" className="text-xs">
                            Highest
                          </SelectItem>
                          {framerates.map((fps) => (
                            <SelectItem key={fps} value={String(fps)} className="text-xs">
                              {fps} fps
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <ScrollArea className="flex-1 overflow-y-auto my-3 max-h-72">
              <FormatList
                formats={filteredFormats}
                type={activeTab}
                codec={selectedCodec}
                selectedFormat={
                  activeTab === 'video' ? state.selectedVideoFormat : state.selectedAudioFormat
                }
                onFormatChange={(formatId) =>
                  onStateChange(
                    activeTab === 'video'
                      ? { selectedVideoFormat: formatId }
                      : { selectedAudioFormat: formatId }
                  )
                }
              />
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  )
}
