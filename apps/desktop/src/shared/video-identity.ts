const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be'
])
const BILIBILI_HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'])
const YOUTUBE_ID = /^[\w-]{11}$/
const BILIBILI_ID = /^BV[\dA-Za-z]{10}$/

/**
 * Normalize a public video URL to the same identity Desktop and the extension use.
 *
 * @param input Watch, Shorts, Live, share, or Bilibili page URL.
 */
export function videoIdentityFromUrl(input: string): string | null {
  try {
    const url = new URL(input.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null
    }
    const host = url.hostname.toLowerCase()
    if (YOUTUBE_HOSTS.has(host)) {
      const id =
        host === 'youtu.be'
          ? url.pathname.split('/').find(Boolean)
          : url.pathname === '/watch'
            ? url.searchParams.get('v')
            : url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1]
      return id && YOUTUBE_ID.test(id) ? `youtube:${id}` : null
    }
    if (BILIBILI_HOSTS.has(host)) {
      const id =
        url.pathname.match(/\/video\/(BV[\dA-Za-z]{10})(?:\/|$)/)?.[1] ??
        (url.pathname.startsWith('/list/') ? url.searchParams.get('bvid') : null)
      if (!(id && BILIBILI_ID.test(id))) {
        return null
      }
      const requestedPage = Number(url.searchParams.get('p') || 1)
      const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
      return `bilibili:${id}:${page}`
    }
    return null
  } catch {
    return null
  }
}
