/**
 * Check whether a URL should be handled as a playlist-style resource.
 *
 * Issue ref: #316.
 */
export const isPlaylistLikeUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    const hostname = parsed.hostname.toLowerCase()
    const pathname = parsed.pathname.toLowerCase()
    const isYouTubeHost =
      hostname === 'youtu.be' ||
      hostname === 'youtube.com' ||
      hostname === 'www.youtube.com' ||
      hostname === 'm.youtube.com' ||
      hostname === 'music.youtube.com'

    if (isYouTubeHost) {
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
