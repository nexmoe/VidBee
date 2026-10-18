/** Trailing characters kept for one task's live yt-dlp log in main and the renderer. */
export const LIVE_LOG_CHAR_CAP = 80_000

/** `download:log` payload. `chunk` is only the text appended since the previous event. */
export interface DownloadLogIpcPayload {
  id: string
  chunk: string
}

/**
 * Append a log chunk and keep the trailing cap.
 *
 * @param current Text already retained.
 * @param chunk Text to append.
 * @param cap Maximum retained length.
 */
export function appendCappedLog(
  current: string,
  chunk: string,
  cap: number = LIVE_LOG_CHAR_CAP
): string {
  const next = `${current}${chunk}`
  return next.length > cap ? next.slice(next.length - cap) : next
}
