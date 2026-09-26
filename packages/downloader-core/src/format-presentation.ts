import type { VideoFormat } from './types'

type FormatType = 'video' | 'audio'

const isVideoFormat = (format: VideoFormat): boolean =>
  format.videoExt !== 'none' && !!format.vcodec && format.vcodec !== 'none'

const isAudioFormat = (format: VideoFormat): boolean =>
  !!format.acodec &&
  format.acodec !== 'none' &&
  (format.videoExt === 'none' || !format.videoExt || !format.vcodec || format.vcodec === 'none')

export const filterFormatsByType = <T extends VideoFormat>(
  formats: readonly T[],
  type: FormatType
): T[] => formats.filter(type === 'video' ? isVideoFormat : isAudioFormat)

const getFileSize = (format: VideoFormat): number => format.filesize ?? format.filesizeApprox ?? 0

const compareVideoQuality = (a: VideoFormat, b: VideoFormat): number =>
  (b.height ?? 0) - (a.height ?? 0) ||
  (b.fps ?? 0) - (a.fps ?? 0) ||
  getFileSize(b) - getFileSize(a) ||
  a.formatId.localeCompare(b.formatId)

const compareAudioQuality = (a: VideoFormat, b: VideoFormat): number =>
  (b.tbr ?? b.quality ?? 0) - (a.tbr ?? a.quality ?? 0) ||
  getFileSize(b) - getFileSize(a) ||
  a.formatId.localeCompare(b.formatId)

const videoGroupKey = (format: VideoFormat): string =>
  JSON.stringify([
    format.height ?? format.formatId,
    format.width,
    format.fps,
    format.ext,
    format.vcodec,
    format.acodec,
    format.language,
    format.formatNote,
    format.quality
  ])

const audioGroupKey = (format: VideoFormat): string =>
  JSON.stringify([
    format.tbr ?? format.quality ?? format.formatId,
    format.ext,
    format.acodec,
    format.language,
    format.formatNote
  ])

const isHttp = (format: VideoFormat): boolean =>
  format.protocol === 'http' || format.protocol === 'https'

const isHls = (format: VideoFormat): boolean =>
  format.protocol === 'm3u8' || format.protocol === 'm3u8_native'

/** Prefer a direct transfer only after matching the rendition's media properties. */
const compareTransport = (a: VideoFormat, b: VideoFormat): number => {
  if (isHttp(a) && isHls(b)) {
    return -1
  }
  if (isHls(a) && isHttp(b)) {
    return 1
  }
  return 0
}

const pickGroups = <T extends VideoFormat>(
  formats: readonly T[],
  key: (format: T) => string,
  compare: (a: T, b: T) => number
): T[] => {
  const groups = new Map<string, T>()
  for (const format of formats) {
    const groupKey = key(format)
    const previous = groups.get(groupKey)
    if (!previous || (compareTransport(format, previous) || compare(format, previous)) < 0) {
      groups.set(groupKey, format)
    }
  }
  return [...groups.values()]
}

/** Keep the desktop and web format pickers consistent. */
export const getDisplayFormats = <T extends VideoFormat>({
  formats,
  type,
  codec
}: {
  formats: readonly T[]
  type: FormatType
  codec?: string
}): { videoFormats: T[]; audioFormats: T[] } => {
  const videos = formats.filter(isVideoFormat)
  const audios = formats.filter(isAudioFormat)
  const videoFormats = pickGroups(videos, videoGroupKey, compareVideoQuality).sort(
    compareVideoQuality
  )
  const audioFormats =
    type === 'audio' && codec === 'auto'
      ? pickGroups(audios, audioGroupKey, compareAudioQuality)
      : audios
  return { videoFormats, audioFormats: audioFormats.sort(compareAudioQuality) }
}
