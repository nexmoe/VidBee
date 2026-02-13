const YOUTUBE_HOST_SUFFIXES = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] as const
const YOUTUBE_SAFE_PLAYER_CLIENTS = 'default,-web,-web_safari'

const hasYouTubeHost = (host: string): boolean =>
  YOUTUBE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))

export const isYouTubeUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return hasYouTubeHost(host)
  } catch {
    return false
  }
}

export const appendYouTubeSafeExtractorArgs = (args: string[], url: string): void => {
  if (!isYouTubeUrl(url)) {
    return
  }
  args.push('--extractor-args', `youtube:player_client=${YOUTUBE_SAFE_PLAYER_CLIENTS}`)
}
