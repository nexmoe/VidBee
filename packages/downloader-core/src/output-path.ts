const INVALID_VARIATION_SELECTOR_REGEX = /[\ufe00-\ufe0f]/gu
const INVALID_PATH_SEGMENT_PUNCTUATION_REGEX = /[\\/:*?"<>|]+/g

export interface VideoDownloadPathInfo {
  title?: string
  uploader?: string
}

const isInvalidPathCodePoint = (codePoint: number): boolean => {
  if (codePoint <= 0x1f) {
    return true
  }
  if (codePoint >= 0x7f && codePoint <= 0x9f) {
    return true
  }
  return codePoint >= 0xff_f0 && codePoint <= 0xff_ff
}

/**
 * Normalize user-derived path segments so they remain valid on filesystems.
 *
 * @param value Raw folder or file fragment.
 * @returns A trimmed, punctuation-safe segment.
 */
export const sanitizePathSegment = (value: string): string => {
  const filtered = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && !isInvalidPathCodePoint(codePoint)
    })
    .join('')

  return filtered
    .replace(INVALID_VARIATION_SELECTOR_REGEX, '')
    .replace(INVALID_PATH_SEGMENT_PUNCTUATION_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
}

/**
 * Sanitize a folder name generated from remote metadata.
 *
 * @param value Uploader or title.
 * @param fallback Used when the value is empty after sanitizing.
 * @returns A usable folder name.
 */
export const sanitizeFolderName = (value: string, fallback: string): string => {
  const trimmed = value.trim()
  if (!trimmed) {
    return fallback
  }
  const sanitized = sanitizePathSegment(trimmed)
  return sanitized || fallback
}

/**
 * Resolve the on-disk folder for a single-video download.
 *
 * Files land in `{downloadPath}/{channel}` by default, or `{downloadPath}`
 * when channel subfolders are disabled.
 *
 * @param basePath Configured download directory.
 * @param info Optional title/uploader from the video.
 * @param skipChannelSubfolders When true, skip the channel folder.
 * @returns Destination directory.
 */
export const resolveAutoVideoDownloadPath = (
  basePath: string,
  info?: VideoDownloadPathInfo | null,
  skipChannelSubfolders = false
): string => {
  if (!info || skipChannelSubfolders) {
    return basePath
  }
  const label = info.uploader?.trim() || info.title?.trim()
  if (!label) {
    return basePath
  }
  const separator = basePath.includes('\\') && !basePath.includes('/') ? '\\' : '/'
  const trimmedBase = basePath.replace(/[\\/]+$/, '')
  return `${trimmedBase}${separator}${sanitizeFolderName(label, 'Video')}`
}
