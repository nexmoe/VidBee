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
import { useCachedThumbnail } from '../../hooks/use-cached-thumbnail'
import { settingsAtom } from '../../store/settings'
import { DOWNLOAD_FEEDBACK_ISSUE_TITLE, FeedbackLinkButtons } from '../feedback/FeedbackLinks'

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
  if (!seconds) {
    return '00:00'
  }
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
  if (!codec || codec === 'none') {
    return 'Unknown'
  }
  return codec.split('.')[0].toUpperCase()
}

const isHlsFormat = (format: VideoFormat): boolean =>
  format.protocol === 'm3u8' || format.protocol === 'm3u8_native'

const isHttpProtocol = (format: VideoFormat): boolean =>
  !!format.protocol && format.protocol.startsWith('http')

const filterFormatsByType = (
  formats: VideoInfo['formats'],
  activeTab: 'video' | 'audio'
): VideoInfo['formats'] => {
  if (!formats) {
    return []
  }

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
        return sorted.at(-1) ?? sorted[0]
      }

      if (!heightLimit) {
        return sorted[0]
      }

      const matchingLimit = sorted.find((format) => {
        if (!format.height) {
          return false
        }
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
      if (autoVideos.length > 0 && !(selectedFormat && hasSelectedVideo)) {
        const preferred = pickVideoFormatForPreset(autoVideos, settings.oneClickQuality)
        if (preferred) {
          onFormatChange(preferred.format_id)
        }
      }
    } else {
      const hasSelectedAudio = finalAudios.some((format) => format.format_id === selectedFormat)
      if (finalAudios.length > 0 && !(selectedFormat && hasSelectedAudio)) {
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
    if (!bytes) {
      return t('download.unknownSize')
    }
    const mb = bytes / 1_000_000
    return `${mb.toFixed(2)} MB`
  }

  const formatMetaLabel = (format: VideoFormat) => {
    const parts: string[] = []
    const pushPart = (label: string, value?: string) => {
      if (!value) {
        return
      }
      parts.push(`${label}:${value}`)
    }
    pushPart('proto', format.protocol)
    pushPart('lang', format.language?.trim())
    if (format.tbr) {
      pushPart('tbr', `${Math.round(format.tbr)}k`)
    }
    if (typeof format.quality === 'number') {
      pushPart('q', String(format.quality))
    }
    if (format.vcodec && format.vcodec !== 'none') {
      pushPart('vcodec', format.vcodec)
    }
    if (format.acodec && format.acodec !== 'none') {
      pushPart('acodec', format.acodec)
    }

    return parts.join(' • ')
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
    <RadioGroup className="w-full gap-1" onValueChange={onFormatChange} value={selectedFormat}>
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
        const metaLabel = formatMetaLabel(format)
        const isSelected = selectedFormat === format.format_id

        return (
          <label
            className={cn(
              'relative flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors',
              isSelected ? 'bg-primary/10' : 'hover:bg-muted'
            )}
            htmlFor={`${type}-${format.format_id}`}
            key={format.format_id}
          >
            <RadioGroupItem
              className="hidden shrink-0"
              id={`${type}-${format.format_id}`}
              value={format.format_id}
            />

            <div className="flex min-w-0 flex-1 items-center gap-4">
              <span
                className={cn('w-16 shrink-0 font-medium text-sm', isSelected && 'text-primary')}
              >
                {qualityLabel}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-muted-foreground text-xs">{detailLabel}</span>
                  {thirdColumnLabel && thirdColumnLabel !== '-' && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground">
                      {thirdColumnLabel}
                    </span>
                  )}
                </div>
                {metaLabel && (
                  <div className="mt-0.5 break-words text-[10px] text-muted-foreground/70 leading-snug">
                    {metaLabel}
                  </div>
                )}
              </div>

              <span className="w-20 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
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
    if (!videoInfo?.formats) {
      return []
    }
    const baseFormats = filterFormatsByType(videoInfo.formats, activeTab)
    if (baseFormats.length === 0) {
      return []
    }

    const hasHttpFormats = baseFormats.some(isHttpProtocol)
    if (!hasHttpFormats) {
      return baseFormats
    }

    const nonHlsFormats = baseFormats.filter((format) => !isHlsFormat(format))
    return nonHlsFormats.length > 0 ? nonHlsFormats : baseFormats
  }, [videoInfo?.formats, activeTab])

  const containers = useMemo(() => {
    if (relevantFormats.length === 0) {
      return []
    }
    const exts = new Set(relevantFormats.map((format) => format.ext))
    return Array.from(exts).sort()
  }, [relevantFormats])

  useEffect(() => {
    if (containers.length === 0) {
      return undefined
    }

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
    if (relevantFormats.length === 0) {
      return []
    }

    if (!selectedContainer) {
      return relevantFormats
    }

    return relevantFormats.filter((format) => format.ext === selectedContainer)
  }, [relevantFormats, selectedContainer])

  const codecs = useMemo(() => {
    if (formatsByContainer.length === 0) {
      return []
    }

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
    if (codecs.length === 0) {
      return undefined
    }
    if (selectedCodec && selectedCodec !== 'auto' && !codecs.includes(selectedCodec)) {
      const timer = setTimeout(() => {
        onStateChange({ selectedCodec: 'auto' })
      }, 0)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [codecs, selectedCodec, onStateChange])

  const formatsByCodec = useMemo(() => {
    if (!selectedCodec || selectedCodec === 'auto') {
      return formatsByContainer
    }
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
    if (activeTab !== 'video') {
      return []
    }
    const SetVals = new Set<number>()
    formatsByCodec.forEach((format) => {
      if (format.fps) {
        SetVals.add(format.fps)
      }
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
    <div className="flex min-h-0 flex-1 flex-col">
      {loading && !error && (
        <div className="flex min-h-[200px] flex-1 flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">{t('download.fetchingVideoInfo')}</p>
        </div>
      )}

      {error && (
        <div className="mb-3 shrink-0 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium text-destructive text-sm">{t('errors.fetchInfoFailed')}</p>
              <p className="break-words text-muted-foreground/80 text-xs">{error}</p>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-[10px] text-muted-foreground/70">
              {t('download.feedback.title')}
            </span>
            <div className="flex flex-wrap gap-1.5">
              <FeedbackLinkButtons
                buttonClassName="h-5 gap-1 px-1.5 text-[10px]"
                buttonSize="sm"
                buttonVariant="outline"
                error={error}
                iconClassName="h-2.5 w-2.5"
                includeAppInfo
                issueTitle={DOWNLOAD_FEEDBACK_ISSUE_TITLE}
                sourceUrl={feedbackSourceUrl}
                ytDlpCommand={ytDlpCommand}
              />
            </div>
          </div>
        </div>
      )}

      {!loading && videoInfo && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 gap-4 py-4">
            <div className="relative w-32 shrink-0 overflow-hidden rounded-md bg-muted">
              <ImageWithPlaceholder
                alt={displayTitle}
                className="aspect-video h-full w-full object-cover"
                src={cachedThumbnail}
              />
              <div className="absolute right-1 bottom-1 rounded bg-black/80 px-1 text-[10px] text-white">
                {formatDuration(videoInfo.duration)}
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
              <div className="space-y-0.5">
                <h3 className="line-clamp-2 font-bold text-[13px] leading-tight">{displayTitle}</h3>
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  {videoInfo.uploader && (
                    <span className="max-w-[140px] truncate font-semibold uppercase tracking-wider opacity-70">
                      {videoInfo.uploader}
                    </span>
                  )}
                  {videoInfo.webpage_url && (
                    <a
                      className="transition-colors hover:text-primary"
                      href={videoInfo.webpage_url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
                  <Button
                    className={cn(
                      'h-5 rounded-sm px-2 text-[11px]',
                      activeTab === 'video'
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground/60'
                    )}
                    onClick={() => onStateChange({ activeTab: 'video' })}
                    size="sm"
                    variant={activeTab === 'video' ? 'secondary' : 'ghost'}
                  >
                    {t('download.video')}
                  </Button>
                  <Button
                    className={cn(
                      'h-5 rounded-sm px-2 text-[11px]',
                      activeTab === 'audio'
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground/60'
                    )}
                    onClick={() => onStateChange({ activeTab: 'audio' })}
                    size="sm"
                    variant={activeTab === 'audio' ? 'secondary' : 'ghost'}
                  >
                    {t('download.audio')}
                  </Button>
                </div>

                <Button
                  className={cn(
                    'h-6 w-6 rounded-full p-0 font-normal text-muted-foreground transition-colors hover:bg-muted',
                    showAdvanced && 'bg-muted text-foreground'
                  )}
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  size="sm"
                  variant="ghost"
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              className={cn(
                'grid transition-all duration-300 ease-in-out',
                showAdvanced ? 'grid-rows-[1fr] border-b py-3' : 'grid-rows-[0fr]'
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[120px] flex-1 space-y-1.5">
                    <Label className="px-0.5 font-medium text-muted-foreground text-xs">
                      {t('download.container') || 'Format'}
                    </Label>
                    <Select
                      disabled={containers.length <= 1}
                      onValueChange={(value) => onStateChange({ selectedContainer: value })}
                      value={selectedContainer || ''}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Container" />
                      </SelectTrigger>
                      <SelectContent>
                        {containers.map((ext) => (
                          <SelectItem className="text-xs" key={ext} value={ext}>
                            {ext.toUpperCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="min-w-[120px] flex-1 space-y-1.5">
                    <Label className="px-0.5 font-medium text-muted-foreground text-xs">
                      Codec
                    </Label>
                    <Select
                      disabled={codecs.length <= 1}
                      onValueChange={(value) => onStateChange({ selectedCodec: value })}
                      value={selectedCodec || 'auto'}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Auto" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem className="text-xs" value="auto">
                          Auto
                        </SelectItem>
                        {codecs.map((codecName) => (
                          <SelectItem className="text-xs" key={codecName} value={codecName}>
                            {codecName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {activeTab === 'video' && (
                    <div className="min-w-[120px] flex-1 space-y-1.5">
                      <Label className="px-0.5 font-medium text-muted-foreground text-xs">
                        Frame Rate
                      </Label>
                      <Select
                        disabled={framerates.length === 0}
                        onValueChange={(value) => onStateChange({ selectedFps: value })}
                        value={selectedFps || 'highest'}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Highest" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem className="text-xs" value="highest">
                            Highest
                          </SelectItem>
                          {framerates.map((fps) => (
                            <SelectItem className="text-xs" key={fps} value={String(fps)}>
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

            <ScrollArea className="my-3 max-h-72 flex-1 overflow-y-auto">
              <FormatList
                codec={selectedCodec}
                formats={filteredFormats}
                onFormatChange={(formatId) =>
                  onStateChange(
                    activeTab === 'video'
                      ? { selectedVideoFormat: formatId }
                      : { selectedAudioFormat: formatId }
                  )
                }
                selectedFormat={
                  activeTab === 'video' ? state.selectedVideoFormat : state.selectedAudioFormat
                }
                type={activeTab}
              />
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  )
}
