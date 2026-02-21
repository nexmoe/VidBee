import type { DownloadOptions, VideoFormat } from '../../shared/types'

export const clampPercent = (value?: number): number => {
  const normalized = typeof value === 'number' ? value : 0
  if (Number.isNaN(normalized)) {
    return 0
  }
  return Math.min(100, Math.max(0, normalized))
}

export const isMuxedFormat = (format?: VideoFormat): boolean => {
  if (!format) {
    return false
  }
  const hasVideo = !!format.vcodec && format.vcodec !== 'none'
  const hasAudio = !!format.acodec && format.acodec !== 'none'
  return hasVideo && hasAudio
}

export const estimateProgressParts = (options: DownloadOptions): number => {
  if (options.type === 'audio') {
    return 1
  }

  const audioFormatCount = options.audioFormatIds?.filter((id) => id.trim() !== '').length ?? 0
  if (audioFormatCount > 0) {
    return 1 + audioFormatCount
  }

  const selector = options.format?.trim()
  if (!selector) {
    return 2
  }

  const primary = selector.split('/')[0]?.trim()
  if (!primary) {
    return 2
  }

  const parts = primary
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part !== '')

  if (parts.length <= 1) {
    return 1
  }

  if (parts.some((part) => part === 'none')) {
    return 1
  }

  return parts.length
}
