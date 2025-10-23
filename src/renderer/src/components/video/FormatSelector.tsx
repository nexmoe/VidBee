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
  auto: null,
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
    const videos = formats.filter((f) => f.video_ext !== 'none' && f.vcodec && f.vcodec !== 'none')
    const audios = formats.filter(
      (f) => f.acodec && f.acodec !== 'none' && (f.video_ext === 'none' || !f.video_ext)
    )

    // Apply showMoreFormats filter
    const filteredVideos = settings.showMoreFormats
      ? videos
      : videos.filter((f) => f.ext !== 'webm' && !f.vcodec?.startsWith('vp'))

    const filteredAudios = settings.showMoreFormats
      ? audios
      : audios.filter((f) => f.ext !== 'webm')

    setVideoFormats(filteredVideos)
    setAudioFormats(filteredAudios)

    // Auto-select best format based on preferences
    if (filteredVideos.length > 0 && !selectedVideo) {
      const preferred = pickVideoFormatForPreset(filteredVideos, settings.oneClickQuality)
      if (preferred) {
        setSelectedVideo(preferred.format_id)
        onVideoFormatChange?.(preferred.format_id)
      }
    }

    if (filteredAudios.length > 0 && !selectedAudio) {
      const best = filteredAudios[0]
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
    const quality = `${format.height || '???'}p${format.fps === 60 ? '60' : ''}`
    const codec = settings.showMoreFormats ? ` | ${format.vcodec?.split('.')[0]}` : ''
    const size = formatSize(format.filesize || format.filesize_approx)
    const hasAudio = format.acodec !== 'none' ? ' 🔊' : ''
    return `${quality} | ${format.ext} ${codec} | ${size}${hasAudio}`
  }

  const formatAudioLabel = (format: VideoFormat) => {
    const quality = format.format_note || t('download.unknownQuality')
    const ext = format.ext === 'webm' ? 'opus' : format.ext
    const size = formatSize(format.filesize || format.filesize_approx)
    return `${quality} | ${ext} | ${size}`
  }

  if (type === 'video') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>{t('download.selectVideoFormat')}</Label>
          <Select
            value={selectedVideo}
            onValueChange={(value) => {
              setSelectedVideo(value)
              onVideoFormatChange?.(value)
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {videoFormats.map((format) => (
                <SelectItem
                  key={format.format_id}
                  value={format.format_id}
                  className="font-mono text-xs"
                >
                  {formatVideoLabel(format)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t('download.selectAudioFormat')}</Label>
          <Select
            value={selectedAudio}
            onValueChange={(value) => {
              setSelectedAudio(value)
              onAudioFormatChange?.(value)
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('download.noAudio')}</SelectItem>
              {audioFormats.map((format) => (
                <SelectItem
                  key={format.format_id}
                  value={format.format_id}
                  className="font-mono text-xs"
                >
                  {formatAudioLabel(format)}
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
    <div className="space-y-2">
      <Label>{t('download.selectFormat')}</Label>
      <Select
        value={selectedAudio}
        onValueChange={(value) => {
          setSelectedAudio(value)
          onAudioFormatChange?.(value)
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {audioFormats.map((format) => (
            <SelectItem
              key={format.format_id}
              value={format.format_id}
              className="font-mono text-xs"
            >
              {formatAudioLabel(format)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
