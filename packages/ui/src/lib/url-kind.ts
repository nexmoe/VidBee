const YOUTUBE_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be'
] as const
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
    const hostname = parsed.hostname.toLowerCase()
    const pathname = parsed.pathname.toLowerCase()
    const isYouTubeHost = YOUTUBE_HOSTS.some((host) => hostname === host)

    if (isYouTubeHost) {
      if (YOUTUBE_CHANNEL_PATH.test(pathname)) {
        return true
      }

      if (pathname === '/playlist') {
        return Boolean(parsed.searchParams.get('list')?.trim())
      }

      if (hostname === 'youtu.be' && pathname.length > 1) {
        return false
      }

      if (pathname === '/watch' && Boolean(parsed.searchParams.get('v')?.trim())) {
        return false
      }

      if (pathname.startsWith('/shorts/') || pathname.startsWith('/embed/')) {
        return false
      }
    }

    const playlistQueryKeys = ['collection', 'list', 'playlist', 'set']
    if (
      playlistQueryKeys.some((key) => {
        return Boolean(parsed.searchParams.get(key)?.trim())
      })
    ) {
      return true
    }

    return ['/playlist', '/playlists/', '/collection/', '/collections/', '/sets/'].some((token) =>
      pathname.includes(token)
    )
  } catch {
    return false
  }
}
