import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
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
}

export function FormatSelector({
  formats,
  type,
  onVideoFormatChange,
  onAudioFormatChange
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
    // Filter and sort formats
    // Exclude m3u8/HLS formats as they are streaming formats not suitable for direct download
    const isVideoFormat = (format: VideoFormat) =>
      format.video_ext !== 'none' && format.vcodec && format.vcodec !== 'none'
    const isAudioFormat = (format: VideoFormat) =>
      format.acodec &&
      format.acodec !== 'none' &&
      (format.video_ext === 'none' || !format.video_ext)
    const isHlsFormat = (format: VideoFormat) =>
      format.protocol === 'm3u8' || format.protocol === 'm3u8_native'

    const videoCandidates = formats.filter(
      (format) => isVideoFormat(format) && !isHlsFormat(format)
    )
    const audioCandidates = formats.filter(
      (format) => isAudioFormat(format) && !isHlsFormat(format)
    )

    const videos =
      videoCandidates.length > 0
        ? videoCandidates
        : formats.filter((format) => isVideoFormat(format))
    const audios =
      audioCandidates.length > 0
        ? audioCandidates
        : formats.filter((format) => isAudioFormat(format))

    // Apply showMoreFormats filter
    const filteredVideos = settings.showMoreFormats
      ? videos
      : videos.filter((f) => f.ext !== 'webm' && !f.vcodec?.startsWith('vp'))

    const filteredAudios = settings.showMoreFormats
      ? audios
      : audios.filter((f) => f.ext !== 'webm')

    const finalVideos = filteredVideos.length > 0 ? filteredVideos : videos
    const finalAudios = filteredAudios.length > 0 ? filteredAudios : audios

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
    if (finalVideos.length > 0 && !selectedVideo) {
      const preferred = pickVideoFormatForPreset(finalVideos, settings.oneClickQuality)
      if (preferred) {
        setSelectedVideo(preferred.format_id)
        onVideoFormatChange?.(preferred.format_id)
      }
    }

    if (finalAudios.length > 0 && !selectedAudio) {
      const best = finalAudios[0]
      setSelectedAudio(best.format_id)
      onAudioFormatChange?.(best.format_id)
    }
  }, [
    formats,
    settings,
    selectedVideo,
    selectedAudio,
    onAudioFormatChange,
    onVideoFormatChange,
    pickVideoFormatForPreset
  ])

  const formatSize = (bytes?: number) => {
    if (!bytes) return t('download.unknownSize')
    const mb = bytes / 1000000
    return `${mb.toFixed(2)} MB`
  }

  const formatVideoLabel = (format: VideoFormat) => {
    const parts: string[] = []
    // Resolution
    if (format.height) {
      parts.push(`${format.height}p${format.fps === 60 ? '60' : ''}`)
    }
    // Format extension
    parts.push(format.ext.toUpperCase())
    // Codec (if showMoreFormats is enabled)
    if (settings.showMoreFormats && format.vcodec) {
      parts.push(format.vcodec.split('.')[0])
    }
    // Audio indicator
    if (format.acodec !== 'none') {
      parts.push('🔊')
    }
    // File size
    const size = formatSize(format.filesize || format.filesize_approx)
    if (size !== t('download.unknownSize')) {
      parts.push(size)
    }
    return parts.join(' • ')
  }

  const formatAudioLabel = (format: VideoFormat) => {
    const parts: string[] = []
    // Quality
    const quality = format.format_note || t('download.unknownQuality')
    parts.push(quality)
    // Format extension
    const ext = format.ext === 'webm' ? 'opus' : format.ext
    parts.push(ext.toUpperCase())
    // File size
    const size = formatSize(format.filesize || format.filesize_approx)
    if (size !== t('download.unknownSize')) {
      parts.push(size)
    }
    return parts.join(' • ')
  }

  if (type === 'video') {
    return (
      <div className="space-y-5">
        <div className="space-y-3">
          <Label className="text-sm font-semibold">{t('download.selectVideoFormat')}</Label>
          <Select
            value={selectedVideo}
            onValueChange={(value) => {
              setSelectedVideo(value)
              onVideoFormatChange?.(value)
            }}
          >
            <SelectTrigger className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-[300px] p-1.5">
              {videoFormats.map((format) => (
                <SelectItem
                  key={format.format_id}
                  value={format.format_id}
                  className="cursor-pointer py-2.5"
                >
                  <span className="text-sm">{formatVideoLabel(format)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <Label className="text-sm font-semibold">{t('download.selectAudioFormat')}</Label>
          <Select
            value={selectedAudio}
            onValueChange={(value) => {
              setSelectedAudio(value)
              onAudioFormatChange?.(value)
            }}
          >
            <SelectTrigger className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-[300px] p-1.5">
              <SelectItem value="none" className="cursor-pointer py-2.5">
                <span className="text-sm">{t('download.noAudio')}</span>
              </SelectItem>
              {audioFormats.map((format) => (
                <SelectItem
                  key={format.format_id}
                  value={format.format_id}
                  className="cursor-pointer py-2.5"
                >
                  <span className="text-sm">{formatAudioLabel(format)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    )
  }

  // Audio only
  return (
    <div className="space-y-3">
      <Label className="text-sm font-semibold">{t('download.selectFormat')}</Label>
      <Select
        value={selectedAudio}
        onValueChange={(value) => {
          setSelectedAudio(value)
          onAudioFormatChange?.(value)
        }}
      >
        <SelectTrigger className="h-11">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-[300px] p-1.5">
          {audioFormats.map((format) => (
            <SelectItem
              key={format.format_id}
              value={format.format_id}
              className="cursor-pointer py-2.5"
            >
              <span className="text-sm">{formatAudioLabel(format)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
