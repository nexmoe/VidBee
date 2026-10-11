import type { TaskInput } from './types'

const BILIBILI_HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'])
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com'
])
const BILIBILI_VIDEO_PATH = /^\/video\/((?:BV|av)[^/]+)\/?$/i
const YOUTUBE_VIDEO_PATH = /^\/(?:shorts|embed|live)\/([^/]+)\/?$/
const TRACKING_PARAMETERS = new Set(['spm_id_from', 'vd_source', 'fbclid', 'gclid', 'msclkid'])

/** Identify known videos across share URLs while preserving generic content query parameters. */
function mediaUrlIdentity(value: string): string {
  const url = new URL(value.trim())
  if (!(url.username || url.password)) {
    const bilibiliId = BILIBILI_HOSTS.has(url.hostname)
      ? url.pathname.match(BILIBILI_VIDEO_PATH)?.[1]
      : undefined
    if (bilibiliId) {
      return `bilibili:${bilibiliId}:${url.searchParams.get('p') || '1'}`
    }
    let youtubeId: string | null | undefined
    if (url.hostname === 'youtu.be') {
      youtubeId = url.pathname.split('/')[1]
    } else if (YOUTUBE_HOSTS.has(url.hostname)) {
      youtubeId =
        url.pathname === '/watch'
          ? url.searchParams.get('v')
          : url.pathname.match(YOUTUBE_VIDEO_PATH)?.[1]
    }
    if (youtubeId) {
      return `youtube:${youtubeId}`
    }
  }
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('utm_') || TRACKING_PARAMETERS.has(key)) {
      url.searchParams.delete(key)
    }
  }
  url.searchParams.sort()
  return url.href
}

/** Match media requests independently of their client id, playlist, destination and display metadata. */
export function downloadIdentity(input: TaskInput): string | null {
  if (!['video', 'audio', 'subscription-item'].includes(input.kind)) {
    return null
  }
  try {
    const url = new URL(input.url.trim())
    if (!['http:', 'https:'].includes(url.protocol)) {
      return null
    }
    const options = input.options ?? {}
    const type =
      input.kind === 'subscription-item'
        ? options.type === 'audio'
          ? 'audio'
          : 'video'
        : input.kind
    return JSON.stringify([
      mediaUrlIdentity(input.url),
      type,
      options.format ?? '',
      options.audioFormat ?? null,
      options.audioFormatIds ?? [],
      options.containerFormat ?? 'auto',
      options.startTime ?? '',
      options.endTime ?? '',
      input.rawArgs ?? []
    ])
  } catch {
    return null
  }
}
