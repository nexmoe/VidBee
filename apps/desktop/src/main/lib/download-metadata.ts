import type { DownloadOptions } from '../../shared/types'
import { hasDisplayMetadata } from '../../shared/utils/pending-download'
import { buildVideoInfoDownloadMetadata } from '../../shared/utils/video-info-metadata'
import { scopedLoggers } from '../utils/logger'
import { fetchVideoInfo } from './yt-dlp-info'

type DownloadMetadataInput = Pick<
  DownloadOptions,
  'url' | 'title' | 'thumbnail' | 'description' | 'channel' | 'uploader' | 'viewCount' | 'duration'
>

/** Fill missing display metadata before admission without blocking downloads on probe failures. */
export const hydrateDownloadMetadata = async <T extends DownloadMetadataInput>(
  options: T,
  signal?: AbortSignal
): Promise<T & DownloadMetadataInput> => {
  signal?.throwIfAborted()
  if (hasDisplayMetadata(options)) {
    return options
  }

  try {
    const info = await fetchVideoInfo(options.url, signal)
    signal?.throwIfAborted()
    const metadata = buildVideoInfoDownloadMetadata(info)
    return {
      ...options,
      title: options.title?.trim() ? options.title : metadata.title,
      thumbnail: options.thumbnail?.trim() ? options.thumbnail : metadata.thumbnail,
      description: options.description ?? metadata.description,
      channel: options.channel ?? metadata.channel,
      uploader: options.uploader ?? metadata.uploader,
      viewCount: options.viewCount ?? metadata.viewCount,
      duration: options.duration ?? metadata.duration
    }
  } catch (error) {
    signal?.throwIfAborted()
    scopedLoggers.download.warn('Failed to hydrate download metadata', error)
    return options
  }
}
