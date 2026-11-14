export interface MetadataRequestCoordinator {
  beginRequest: () => number
  invalidate: () => void
  isCurrentRequest: (requestId: number) => boolean
}

/** Ignore metadata responses belonging to an older source, mode or dialog lifetime. */
export const createMetadataRequestCoordinator = (): MetadataRequestCoordinator => {
  let currentRequestId = 0
  return {
    beginRequest: () => ++currentRequestId,
    invalidate: () => {
      currentRequestId += 1
    },
    isCurrentRequest: (requestId) => requestId === currentRequestId
  }
}

interface MetadataFormat {
  formatId?: string
  format_id?: string
  vcodec?: string
  acodec?: string
  videoExt?: string
  video_ext?: string
}

/** Match the desktop and web media pickers, including audio-only and muxed streams. */
export const hasDownloadableFormats = (formats: readonly MetadataFormat[] | undefined): boolean =>
  formats?.some((format) => {
    if (!(format.formatId || format.format_id)) {
      return false
    }
    const videoExt = format.videoExt ?? format.video_ext
    const hasVideo = !!format.vcodec && format.vcodec !== 'none'
    const hasAudio = !!format.acodec && format.acodec !== 'none'
    return (
      (videoExt !== 'none' && hasVideo) ||
      (hasAudio && (!videoExt || videoExt === 'none' || !hasVideo))
    )
  }) ?? false

/** A count alone cannot populate the playlist selection controls. */
export const hasPlaylistEntries = (
  info: { entryCount: number; entries: readonly unknown[] } | null | undefined
): boolean => (info?.entryCount ?? 0) > 0 && (info?.entries?.length ?? 0) > 0
