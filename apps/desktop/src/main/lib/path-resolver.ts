import {
  resolveAutoVideoDownloadPath as resolveSharedVideoDownloadPath,
  sanitizeFolderName as sanitizeSharedFolderName
} from '@vidbee/downloader-core/output-path'
import type { AppSettings, DownloadOptions } from '../../shared/types'

export const sanitizeFolderName = sanitizeSharedFolderName
export const resolveAutoVideoDownloadPath = resolveSharedVideoDownloadPath

/**
 * Attach the automatic channel folder when the caller did not pick a custom
 * directory. Playlist, subscription, and user-selected folders keep the path
 * they already set.
 */
export const applyAutoVideoDownloadPath = (
  options: DownloadOptions,
  settings: Pick<AppSettings, 'downloadPath' | 'downloadWithoutChannelSubfolders'>
): DownloadOptions => {
  if (options.customDownloadPath?.trim()) {
    return options
  }
  return {
    ...options,
    customDownloadPath: resolveAutoVideoDownloadPath(
      settings.downloadPath,
      { title: options.title, uploader: options.uploader },
      settings.downloadWithoutChannelSubfolders
    )
  }
}
