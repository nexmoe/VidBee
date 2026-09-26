import type { VideoFormat } from '@shared/types'
import {
  filterFormatsByType as filterCoreFormats,
  getDisplayFormats as getCoreDisplayFormats
} from '@vidbee/downloader-core/format-presentation'

const toCoreFormat = (format: VideoFormat) => ({
  ...format,
  formatId: format.format_id,
  filesizeApprox: format.filesize_approx,
  formatNote: format.format_note,
  videoExt: format.video_ext,
  audioExt: format.audio_ext,
  original: format
})

export const filterFormatsByType = (
  formats: readonly VideoFormat[],
  type: 'video' | 'audio'
): VideoFormat[] =>
  filterCoreFormats(formats.map(toCoreFormat), type).map((format) => format.original)

export const getDisplayFormats = ({
  formats,
  type,
  codec
}: {
  formats: readonly VideoFormat[]
  type: 'video' | 'audio'
  codec?: string
}): { videoFormats: VideoFormat[]; audioFormats: VideoFormat[] } => {
  const result = getCoreDisplayFormats({ formats: formats.map(toCoreFormat), type, codec })
  return {
    videoFormats: result.videoFormats.map((format) => format.original),
    audioFormats: result.audioFormats.map((format) => format.original)
  }
}
