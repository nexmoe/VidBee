const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'm.youtube.com'] as const
// YouTube channel/handle landing pages (e.g. /@handle/videos, /channel/UC…,
// /user/…, /c/…) list many videos; route them through the playlist flow so a
// single unavailable entry can't abort the whole fetch (GitHub issue #322).
const YOUTUBE_CHANNEL_PATH = /^\/(@[^/]+|channel\/|user\/|c\/)/i

/**
 * Check whether a URL should be handled as a playlist-style resource.
 *
 * Issue ref: #316, #322.
 */
export const isPlaylistLikeUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    const playlistQueryKeys = ['collection', 'list', 'playlist', 'set']
    if (
      playlistQueryKeys.some((key) => {
        return Boolean(parsed.searchParams.get(key)?.trim())
      })
    ) {
      return true
    }

    const host = parsed.hostname.toLowerCase()
    const isYouTubeHost = YOUTUBE_HOSTS.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`)
    )
    if (isYouTubeHost && YOUTUBE_CHANNEL_PATH.test(parsed.pathname)) {
      return true
    }

    const pathname = parsed.pathname.toLowerCase()
    return ['/playlist', '/playlists/', '/collection/', '/collections/', '/sets/'].some((token) =>
      pathname.includes(token)
    )
  } catch {
    return false
  }
}
