/**
 * Shared yt-dlp format-id selector used by Desktop and Web download dialogs.
 *
 * A single-format pick must degrade to best-available instead of hard-failing
 * with "Requested format is not available". Some sites list premium tiers
 * when cookies are present even for accounts that cannot fetch them.
 */

export interface FormatSelectorInput {
  vcodec?: string
  acodec?: string
  ext?: string
}

export const SINGLE_FORMAT_FALLBACK = 'bestvideo+bestaudio/best'

export const isMuxedVideoFormat = (format: FormatSelectorInput | undefined): boolean =>
  Boolean(format?.vcodec && format.vcodec !== 'none' && format.acodec && format.acodec !== 'none')

export const resolvePreferredAudioExt = (videoExt: string | undefined): string | undefined => {
  if (!videoExt) {
    return undefined
  }

  const normalizedExt = videoExt.toLowerCase()
  if (normalizedExt === 'mp4') {
    return 'm4a'
  }
  if (normalizedExt === 'webm') {
    return 'webm'
  }
  return undefined
}

export const buildSingleVideoFormatSelector = (
  formatId: string,
  format: FormatSelectorInput | undefined
): string => {
  if (!format || isMuxedVideoFormat(format)) {
    return `${formatId}/${SINGLE_FORMAT_FALLBACK}`
  }

  const preferredAudioExt = resolvePreferredAudioExt(format.ext)
  if (!preferredAudioExt) {
    return `${formatId}+bestaudio/${SINGLE_FORMAT_FALLBACK}`
  }

  return `${formatId}+bestaudio[ext=${preferredAudioExt}]/${formatId}+bestaudio/${SINGLE_FORMAT_FALLBACK}`
}
