import type {
  AppSettings,
  DownloadOptions,
  OneClickQualityPreset,
  VideoFormat
} from '../../shared/types'

const qualityPresetToVideoHeight: Record<OneClickQualityPreset, number | null> = {
  best: null,
  good: 1080,
  normal: 720,
  bad: 480,
  worst: 360
}

const qualityPresetToAudioAbr: Record<OneClickQualityPreset, number | null> = {
  best: 320,
  good: 256,
  normal: 192,
  bad: 128,
  worst: 96
}

const selectVideoFormatForPreset = (
  formats: VideoFormat[],
  preset: OneClickQualityPreset
): VideoFormat | undefined => {
  if (formats.length === 0) {
    return undefined
  }

  const sorted = [...formats].sort((a, b) => {
    const heightDiff = (b.height ?? 0) - (a.height ?? 0)
    if (heightDiff !== 0) return heightDiff
    const fpsDiff = (b.fps ?? 0) - (a.fps ?? 0)
    if (fpsDiff !== 0) return fpsDiff
    return (b.tbr ?? 0) - (a.tbr ?? 0)
  })

  if (preset === 'worst') {
    return sorted[sorted.length - 1] ?? sorted[0]
  }

  const heightLimit = qualityPresetToVideoHeight[preset]
  if (!heightLimit) {
    return sorted[0]
  }

  const withinLimit = sorted.find((format) => {
    const height = format.height ?? 0
    return height > 0 && height <= heightLimit
  })

  return withinLimit ?? sorted[0]
}

const selectAudioFormatForPreset = (
  formats: VideoFormat[],
  preset: OneClickQualityPreset
): VideoFormat | undefined => {
  if (formats.length === 0) {
    return undefined
  }

  const sorted = [...formats].sort((a, b) => {
    const bitrateDiff = (b.tbr ?? 0) - (a.tbr ?? 0)
    if (bitrateDiff !== 0) return bitrateDiff
    const sizeA = a.filesize ?? a.filesize_approx ?? 0
    const sizeB = b.filesize ?? b.filesize_approx ?? 0
    if (sizeB !== sizeA) return sizeB - sizeA
    return 0
  })

  if (preset === 'worst') {
    return sorted[sorted.length - 1] ?? sorted[0]
  }

  const abrLimit = qualityPresetToAudioAbr[preset]
  if (!abrLimit) {
    return sorted[0]
  }

  const withinLimit = sorted.find((format) => {
    const bitrate = format.tbr ?? 0
    return bitrate > 0 && bitrate <= abrLimit
  })

  return withinLimit ?? sorted[0]
}

const findFormatBySelector = (
  formats: VideoFormat[],
  selector?: string
): VideoFormat | undefined => {
  if (!selector) {
    return undefined
  }

  const candidateIds = selector
    .split('/')
    .map((option) => option.split('+')[0].trim())
    .filter((option) => option.length > 0)

  for (const candidateId of candidateIds) {
    const match = formats.find((format) => format.format_id === candidateId)
    if (match) {
      return match
    }
  }

  return undefined
}

export const findFormatByIdCandidates = (
  formats: VideoFormat[],
  rawFormatId: string | undefined
): VideoFormat | undefined => {
  if (!rawFormatId) {
    return undefined
  }

  const parts = rawFormatId
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  for (const part of parts) {
    const match = formats.find((format) => format.format_id === part)
    if (match) {
      return match
    }
  }

  return undefined
}

export const parseSizeToBytes = (value?: string): number | undefined => {
  if (!value) {
    return undefined
  }

  const cleaned = value.trim().replace(/^~\s*/, '')
  if (!cleaned) {
    return undefined
  }

  const match = cleaned.match(/^([\d.,]+)\s*([KMGTP]?i?B)$/i)
  if (!match) {
    return undefined
  }

  const amount = Number(match[1].replace(/,/g, ''))
  if (Number.isNaN(amount)) {
    return undefined
  }

  const unit = match[2].toUpperCase()
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1_000,
    KIB: 1_024,
    MB: 1_000_000,
    MIB: 1_048_576,
    GB: 1_000_000_000,
    GIB: 1_073_741_824,
    TB: 1_000_000_000_000,
    TIB: 1_099_511_627_776
  }

  const multiplier = multipliers[unit]
  if (!multiplier) {
    return undefined
  }

  return Math.round(amount * multiplier)
}

export const resolveSelectedFormat = (
  formats: VideoFormat[],
  options: DownloadOptions,
  settings: AppSettings
): VideoFormat | undefined => {
  const directMatch = findFormatBySelector(formats, options.format)
  if (directMatch) {
    return directMatch
  }

  const preset = settings.oneClickQuality ?? 'best'

  if (options.type === 'video') {
    const videoFormats = formats.filter(
      (format) => format.video_ext !== 'none' && !!format.vcodec && format.vcodec !== 'none'
    )
    return selectVideoFormatForPreset(videoFormats, preset)
  }

  if (options.type === 'audio') {
    const audioFormats = formats.filter(
      (format) =>
        !!format.acodec &&
        format.acodec !== 'none' &&
        (!format.video_ext || format.video_ext === 'none')
    )
    return selectAudioFormatForPreset(audioFormats, preset)
  }

  return undefined
}
