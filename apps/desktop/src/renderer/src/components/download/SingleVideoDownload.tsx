import { Button } from '@renderer/components/ui/button'
import { Label } from '@renderer/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import { RemoteImage } from '@renderer/components/ui/remote-image'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { TabItem, Tabs, TabsList } from '@renderer/components/ui/tabs'
import { cn } from '@renderer/lib/utils'
import type { OneClickQualityPreset, VideoFormat, VideoInfo } from '@shared/types'
import { TimeRangeOptions } from '@vidbee/ui/components/ui/time-range-options'
import { useAtom } from 'jotai'
import { ExternalLink, Loader2, Settings2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { settingsAtom } from '../../store/settings'
import { pickPreferredAudioFormatId } from './audio-format-preferences'
import { DownloadParseErrorBanner } from './DownloadParseErrorBanner'
import { filterFormatsByType, getDisplayFormats } from './format-presentation'

export interface SingleVideoState {
  title: string
  activeTab: 'video' | 'audio'
  selectedVideoFormat: string
  selectedAudioFormat: string
  customDownloadPath: string
  startTime: string
  endTime: string
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

interface FormatListProps {
  formats: VideoFormat[]
  type: 'video' | 'audio'
  codec?: string
  selectedFormat: string
  onFormatChange: (formatId: string) => void
}

/** Render the selectable quality list for the current container/codec filters. */
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
    const { videoFormats: finalVideos, audioFormats: finalAudios } = getDisplayFormats({
      formats,
      type,
      codec
    })

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
        const preferredFormatId = pickPreferredAudioFormatId(
          finalAudios,
          settings.preferredAudioLanguage
        )
        if (preferredFormatId) {
          onFormatChange(preferredFormatId)
        }
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
    settings.preferredAudioLanguage
  ])

  const formatSize = (bytes?: number) => {
    if (!bytes) {
      return t('download.unknownSize')
    }
    const mb = bytes / 1_000_000
    if (mb < 0.1) {
      return `${Math.max(1, Math.round(bytes / 1000))} KB`
    }
    if (mb < 10) {
      return `${mb.toFixed(1)} MB`
    }
    return `${Math.round(mb)} MB`
  }

  const formatVideoQuality = (format: VideoFormat) => {
    if (format.height) {
      return `${format.height}p`
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
    if (format.ext) {
      parts.push(format.ext.toUpperCase())
    }
    if (format.vcodec && format.vcodec !== 'none') {
      parts.push(getCodecShortName(format.vcodec))
    }
    if (format.fps) {
      parts.push(`${format.fps} fps`)
    }
    return parts.join(' · ')
  }

  const formatAudioDetail = (format: VideoFormat) => {
    const ext = format.ext === 'webm' ? 'opus' : format.ext
    const parts: string[] = [ext.toUpperCase()]
    if (format.acodec && format.acodec !== 'none') {
      parts.push(getCodecShortName(format.acodec))
    }
    return parts.join(' · ')
  }

  const list = type === 'video' ? videoFormats : audioFormats

  if (list.length === 0) {
    return null
  }

  return (
    <RadioGroup className="w-full gap-0.5" onValueChange={onFormatChange} value={selectedFormat}>
      {list.map((format) => {
        const qualityLabel =
          type === 'video' ? formatVideoQuality(format) : formatAudioQuality(format)
        const detailLabel = type === 'video' ? formatVideoDetail(format) : formatAudioDetail(format)
        const language = format.language?.trim()
        const sizeLabel = formatSize(format.filesize || format.filesize_approx)
        const isSelected = selectedFormat === format.format_id

        return (
          <label
            className={cn(
              'relative flex cursor-pointer items-center rounded-md px-2.5 py-2 transition-colors duration-150',
              isSelected ? 'bg-muted' : 'hover:bg-muted/60'
            )}
            htmlFor={`${type}-${format.format_id}`}
            key={format.format_id}
          >
            <RadioGroupItem
              className="hidden shrink-0"
              id={`${type}-${format.format_id}`}
              value={format.format_id}
            />

            <div className="grid min-w-0 flex-1 grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-3">
              <span className="font-medium text-sm tabular-nums">{qualityLabel}</span>

              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-muted-foreground text-xs">{detailLabel}</span>
                {language && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground uppercase">
                    {language}
                  </span>
                )}
              </div>

              <span className="text-right text-muted-foreground text-xs tabular-nums">
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
  const [showAdvanced, setShowAdvanced] = useState(false)

  const { title, activeTab, selectedContainer, selectedCodec, selectedFps, startTime, endTime } =
    state
  const displayTitle = title || videoInfo?.title || t('download.fetchingVideoInfo')

  const relevantFormats = useMemo(() => {
    if (!videoInfo?.formats) {
      return []
    }
    return filterFormatsByType(videoInfo.formats, activeTab)
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

  const hasParseResult = Boolean(loading || error || videoInfo)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!hasParseResult && (
        <div className="flex min-h-[140px] flex-col items-center justify-center rounded-md border border-border/70 border-dashed bg-muted/20 px-6 text-center">
          <p className="text-muted-foreground text-sm">{t('download.enterUrl')}</p>
        </div>
      )}

      {loading && !error && (
        <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 rounded-md border border-border/70 border-dashed bg-muted/20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">{t('download.fetchingVideoInfo')}</p>
        </div>
      )}

      {error && (
        <DownloadParseErrorBanner
          error={error}
          showFeedback
          sourceUrl={feedbackSourceUrl}
          title={t('errors.fetchInfoFailed')}
          ytDlpCommand={ytDlpCommand}
        />
      )}

      {!loading && videoInfo && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5 rounded-md border border-border/70 border-dashed bg-muted/20 p-2">
            <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-muted">
              <RemoteImage
                alt={displayTitle}
                className="h-full w-full object-cover"
                src={videoInfo.thumbnail}
              />
            </div>

            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-2 font-medium text-sm leading-snug">{displayTitle}</h2>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
                {videoInfo.uploader && <span className="truncate">{videoInfo.uploader}</span>}
                {videoInfo.uploader && videoInfo.duration ? <span>·</span> : null}
                {videoInfo.duration ? (
                  <span className="shrink-0 tabular-nums">
                    {formatDuration(videoInfo.duration)}
                  </span>
                ) : null}
                {videoInfo.webpage_url && (
                  <a
                    aria-label={t('download.metadata.source')}
                    className="shrink-0 transition-colors hover:text-foreground"
                    href={videoInfo.webpage_url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Tabs
              onValueChange={(value) => onStateChange({ activeTab: value as 'video' | 'audio' })}
              size="compact"
              value={activeTab}
            >
              <TabsList className="rounded-md [&>div]:rounded-md">
                <TabItem label={t('download.video')} value="video" />
                <TabItem label={t('download.audio')} value="audio" />
              </TabsList>
            </Tabs>

            <Button
              aria-label={t('advancedOptions.title')}
              aria-pressed={showAdvanced}
              className={cn(
                'h-7 w-7 shrink-0 rounded-md bg-muted p-0 text-muted-foreground transition-colors duration-150',
                showAdvanced && 'text-foreground'
              )}
              onClick={() => setShowAdvanced(!showAdvanced)}
              size="sm"
              title={t('advancedOptions.title')}
              variant="ghost"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          {showAdvanced && (
            <div className="space-y-3 rounded-md bg-muted/40 p-3">
              <div
                className={cn('grid gap-2', activeTab === 'video' ? 'grid-cols-3' : 'grid-cols-2')}
              >
                <div className="min-w-0 space-y-1">
                  <Label
                    className="font-medium text-muted-foreground text-xs"
                    htmlFor="download-filter-container"
                  >
                    {t('download.metadata.format')}
                  </Label>
                  <Select
                    disabled={containers.length <= 1}
                    onValueChange={(value) => onStateChange({ selectedContainer: value })}
                    value={selectedContainer || ''}
                  >
                    <SelectTrigger className="h-7 text-xs" id="download-filter-container">
                      <SelectValue placeholder={t('download.metadata.format')} />
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

                <div className="min-w-0 space-y-1">
                  <Label
                    className="font-medium text-muted-foreground text-xs"
                    htmlFor="download-filter-codec"
                  >
                    {t('download.metadata.codec')}
                  </Label>
                  <Select
                    disabled={codecs.length <= 1}
                    onValueChange={(value) => onStateChange({ selectedCodec: value })}
                    value={selectedCodec || 'auto'}
                  >
                    <SelectTrigger className="h-7 text-xs" id="download-filter-codec">
                      <SelectValue placeholder={t('download.codecAuto')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem className="text-xs" value="auto">
                        {t('download.codecAuto')}
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
                  <div className="min-w-0 space-y-1">
                    <Label
                      className="font-medium text-muted-foreground text-xs"
                      htmlFor="download-filter-fps"
                    >
                      {t('download.frameRate')}
                    </Label>
                    <Select
                      disabled={framerates.length === 0}
                      onValueChange={(value) => onStateChange({ selectedFps: value })}
                      value={selectedFps || 'highest'}
                    >
                      <SelectTrigger className="h-7 text-xs" id="download-filter-fps">
                        <SelectValue placeholder={t('download.fpsHighest')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem className="text-xs" value="highest">
                          {t('download.fpsHighest')}
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
              <TimeRangeOptions
                endTime={endTime}
                onEndTimeChange={(value) => onStateChange({ endTime: value })}
                onStartTimeChange={(value) => onStateChange({ startTime: value })}
                startTime={startTime}
              />
            </div>
          )}

          <div className="max-h-64 overflow-y-auto">
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
          </div>
        </div>
      )}
    </div>
  )
}
