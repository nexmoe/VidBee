import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import { Table, TableBody, TableCell, TableRow } from '@renderer/components/ui/table'
import { useAtom } from 'jotai'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OneClickQualityPreset, VideoFormat } from '../../../../shared/types'

const qualityPresetToVideoHeight: Record<OneClickQualityPreset, number | null> = {
  best: null,
  good: 1080,
  normal: 720,
  bad: 480,
  worst: 360
}

import { settingsAtom } from '../../store/settings'

interface FormatSelectorProps {
  formats: VideoFormat[]
  type: 'video' | 'audio'
  onVideoFormatChange?: (format: string) => void
  onAudioFormatChange?: (format: string) => void
  codec?: string // 'auto' or specific codec name
}

export function FormatSelector({
  formats,
  type,
  onVideoFormatChange,
  onAudioFormatChange,
  codec
}: FormatSelectorProps) {
  const { t } = useTranslation()
  const [settings] = useAtom(settingsAtom)
  const [videoFormats, setVideoFormats] = useState<VideoFormat[]>([])
  const [audioFormats, setAudioFormats] = useState<VideoFormat[]>([])
  const [selectedVideo, setSelectedVideo] = useState('')
  const [selectedAudio, setSelectedAudio] = useState('')

  const pickVideoFormatForPreset = useCallback(
    (formats: VideoFormat[], preset: OneClickQualityPreset): VideoFormat | null => {
      if (formats.length === 0) {
        return null
      }

      const heightLimit = qualityPresetToVideoHeight[preset]
      const byHeightDescending = (a: VideoFormat, b: VideoFormat) =>
        (b.height ?? 0) - (a.height ?? 0)
      const sorted = [...formats].sort(byHeightDescending)

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
    []
  )

  useEffect(() => {
    // Formats are already filtered by VideoInfoCard based on Container, Codec, etc.
    // We just need to separate video and audio formats, exclude HLS, and sort them.
    const isHlsFormat = (format: VideoFormat) =>
      format.protocol === 'm3u8' || format.protocol === 'm3u8_native'

    // Filter out HLS formats and separate by type
    const filteredFormats = formats.filter((f) => !isHlsFormat(f))

    const isVideoFormat = (format: VideoFormat) =>
      format.video_ext !== 'none' && format.vcodec && format.vcodec !== 'none'
    const isAudioFormat = (format: VideoFormat) =>
      format.acodec &&
      format.acodec !== 'none' &&
      (format.video_ext === 'none' ||
        !format.video_ext ||
        !format.vcodec ||
        format.vcodec === 'none')

    const videos = filteredFormats.filter(isVideoFormat)
    const audios = filteredFormats.filter(isAudioFormat)

    // Get file size for comparison (prefer filesize over filesize_approx)
    const getFileSize = (format: VideoFormat): number => {
      return format.filesize ?? format.filesize_approx ?? 0
    }

    // When codec is 'auto', filter to show only the largest file size per resolution
    let finalVideos = videos
    let finalAudios = audios

    if (codec === 'auto') {
      if (type === 'video') {
        // Group by height (resolution) and keep only the one with largest file size
        const groupedByHeight = new Map<number, VideoFormat[]>()
        videos.forEach((format) => {
          const height = format.height ?? 0
          const existing = groupedByHeight.get(height) || []
          existing.push(format)
          groupedByHeight.set(height, existing)
        })

        finalVideos = Array.from(groupedByHeight.values()).map((group) => {
          // Sort by file size descending and take the first (largest)
          return group.sort((a, b) => getFileSize(b) - getFileSize(a))[0]
        })
      } else {
        // For audio, group by quality/tbr and keep only the one with largest file size
        const groupedByQuality = new Map<string, VideoFormat[]>()
        audios.forEach((format) => {
          // Use tbr or quality as grouping key
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
          // Sort by file size descending and take the first (largest)
          return group.sort((a, b) => getFileSize(b) - getFileSize(a))[0]
        })
      }
    }

    // Sort formats by quality (best first)
    const sortVideoFormatsByQuality = (a: VideoFormat, b: VideoFormat) => {
      // Sort by height (higher is better)
      const aHeight = a.height ?? 0
      const bHeight = b.height ?? 0
      if (aHeight !== bHeight) {
        return bHeight - aHeight
      }
      // If same height, sort by fps (higher is better)
      const aFps = a.fps ?? 0
      const bFps = b.fps ?? 0
      if (aFps !== bFps) {
        return bFps - aFps
      }
      // If same quality, prefer formats with file size information
      const aHasSize = !!(a.filesize || a.filesize_approx)
      const bHasSize = !!(b.filesize || b.filesize_approx)
      if (aHasSize !== bHasSize) {
        return bHasSize ? 1 : -1
      }
      return 0
    }

    const sortAudioFormatsByQuality = (a: VideoFormat, b: VideoFormat) => {
      // Sort by bitrate/quality if available
      const aQuality = a.tbr ?? a.quality ?? 0
      const bQuality = b.tbr ?? b.quality ?? 0
      if (aQuality !== bQuality) {
        return bQuality - aQuality
      }
      // If same quality, prefer formats with file size information
      const aHasSize = !!(a.filesize || a.filesize_approx)
      const bHasSize = !!(b.filesize || b.filesize_approx)
      if (aHasSize !== bHasSize) {
        return bHasSize ? 1 : -1
      }
      return 0
    }

    finalVideos.sort(sortVideoFormatsByQuality)
    finalAudios.sort(sortAudioFormatsByQuality)

    setVideoFormats(finalVideos)
    setAudioFormats(finalAudios)

    // Auto-select best format based on preferences
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

      const hasSelectedVideo = finalVideos.some((format) => format.format_id === selectedVideo)
      if (autoVideos.length > 0 && (!selectedVideo || !hasSelectedVideo)) {
        const preferred = pickVideoFormatForPreset(autoVideos, settings.oneClickQuality)
        if (preferred) {
          setSelectedVideo(preferred.format_id)
          onVideoFormatChange?.(preferred.format_id)
        }
      }
    } else {
      const hasSelectedAudio = finalAudios.some((format) => format.format_id === selectedAudio)
      if (finalAudios.length > 0 && (!selectedAudio || !hasSelectedAudio)) {
        const best = finalAudios[0]
        setSelectedAudio(best.format_id)
        onAudioFormatChange?.(best.format_id)
      }
    }
  }, [
    formats,
    settings.oneClickQuality,
    type,
    selectedVideo,
    selectedAudio,
    onAudioFormatChange,
    onVideoFormatChange,
    pickVideoFormatForPreset,
    codec
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
    // Format extension
    parts.push(format.ext.toUpperCase())
    // Codec information
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
    // Format extension
    const ext = format.ext === 'webm' ? 'opus' : format.ext
    parts.push(ext.toUpperCase())
    if (format.acodec) {
      parts.push(format.acodec.split('.')[0].toUpperCase())
    }
    return parts.join(' • ')
  }

  // Unified table rendering for both video and audio
  const renderFormatTable = () => {
    const formats = type === 'video' ? videoFormats : audioFormats
    const selected = type === 'video' ? selectedVideo : selectedAudio
    const onFormatChange =
      type === 'video'
        ? (value: string) => {
            setSelectedVideo(value)
            onVideoFormatChange?.(value)
          }
        : (value: string) => {
            setSelectedAudio(value)
            onAudioFormatChange?.(value)
          }

    if (formats.length === 0) {
      return null
    }

    return (
      <RadioGroup value={selected} onValueChange={onFormatChange} className="w-full">
        <Table>
          <TableBody>
            {formats.map((format) => {
              const qualityLabel =
                type === 'video' ? formatVideoQuality(format) : formatAudioQuality(format)
              const detailLabel =
                type === 'video' ? formatVideoDetail(format) : formatAudioDetail(format)
              const thirdColumnLabel =
                type === 'video'
                  ? format.fps
                    ? `${format.fps}fps`
                    : '-'
                  : format.acodec
                    ? format.acodec.split('.')[0].toUpperCase()
                    : '-'
              const sizeLabel = formatSize(format.filesize || format.filesize_approx)

              return (
                <TableRow
                  key={format.format_id}
                  className="cursor-pointer"
                  onClick={() => onFormatChange(format.format_id)}
                >
                  <TableCell className="w-[24px] pl-0">
                    <RadioGroupItem
                      className="bg-background mt-1 border-border"
                      value={format.format_id}
                      id={`${type}-${format.format_id}`}
                    />
                  </TableCell>
                  <TableCell className="w-[90px]">
                    <div className="text-sm font-medium">{qualityLabel}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs text-muted-foreground truncate">{detailLabel}</div>
                  </TableCell>
                  <TableCell className="w-[70px]">
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {thirdColumnLabel}
                    </div>
                  </TableCell>
                  <TableCell className="w-[90px] text-right">
                    <div className="text-xs text-muted-foreground tabular-nums">{sizeLabel}</div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </RadioGroup>
    )
  }

  return renderFormatTable()
}
