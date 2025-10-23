export interface PopularSite {
  id: string
  label: string
  description?: string
}

export const popularSites: PopularSite[] = [
  {
    id: 'youtube',
    label: 'YouTube',
    description: 'Long-form and livestream video from creators worldwide.'
  },
  {
    id: 'youtubemusic',
    label: 'YouTube Music',
    description: 'Official music videos, albums, and live performances.'
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    description: 'Short-form mobile videos, effects, and live streams.'
  },
  {
    id: 'facebook',
    label: 'Facebook',
    description: 'Feed, Watch, and Reels videos from public pages.'
  },
  {
    id: 'instagram',
    label: 'Instagram',
    description: 'Feed, Stories, Reels, and Highlights content.'
  },
  {
    id: 'twitter',
    label: 'X (Twitter)',
    description: 'Timeline posts, Spaces recordings, and broadcasts.'
  },
  {
    id: 'soundcloud',
    label: 'SoundCloud',
    description: 'Music tracks, playlists, and DJ sets.'
  },
  {
    id: 'reddit',
    label: 'Reddit',
    description: 'Embedded clips and hosted videos from communities.'
  },
  {
    id: 'vimeo',
    label: 'Vimeo',
    description: 'High-quality creator and business video hosting.'
  },
  {
    id: 'dailymotion',
    label: 'Dailymotion',
    description: 'Global news, sports, and entertainment clips.'
  },
  {
    id: 'twitch',
    label: 'Twitch',
    description: 'Gaming, music, and IRL live streams and VODs.'
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    description: 'Professional talks, webinars, and learning videos.'
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    description: 'Idea pins, how-to reels, and lifestyle inspiration videos.'
  },
  {
    id: 'tumblr',
    label: 'Tumblr',
    description: 'Creative short-form media and fan edits.'
  },
  {
    id: 'mixcloud',
    label: 'Mixcloud',
    description: 'DJ mixes, radio shows, and long-form audio.'
  },
  {
    id: 'niconico',
    label: 'Niconico',
    description: 'Japanese animation, music, and live broadcast archive.'
  },
  {
    id: 'kick',
    label: 'Kick',
    description: 'Creator live streams and replays on the Kick platform.'
  },
  {
    id: 'bandcamp',
    label: 'Bandcamp',
    description: 'Independent artist albums and community releases.'
  }
]
