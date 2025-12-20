import { defineConfig } from 'vite'
import monkey from 'vite-plugin-monkey'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        icon: 'https://vidbee.org/favicon.svg',
        namespace: 'vidbee',
        match: [
          // YouTube
          'https://www.youtube.com/*',
          'https://youtube.com/*',
          'https://music.youtube.com/*',
          // Bilibili (哔哩哔哩)
          'https://www.bilibili.com/*',
          'https://bilibili.com/*',
          // TikTok
          'https://www.tiktok.com/*',
          'https://tiktok.com/*',
          // Vimeo
          'https://vimeo.com/*',
          'https://www.vimeo.com/*',
          // Dailymotion
          'https://www.dailymotion.com/*',
          'https://dailymotion.com/*',
          // Twitch
          'https://www.twitch.tv/*',
          'https://twitch.tv/*',
          // Twitter/X
          'https://twitter.com/*',
          'https://www.twitter.com/*',
          'https://x.com/*',
          'https://www.x.com/*',
          // Instagram
          'https://www.instagram.com/*',
          'https://instagram.com/*',
          // Facebook
          'https://www.facebook.com/*',
          'https://facebook.com/*',
          'https://fb.com/*',
          'https://www.fb.com/*',
          // Reddit
          'https://www.reddit.com/*',
          'https://reddit.com/*',
          // SoundCloud
          'https://soundcloud.com/*',
          'https://www.soundcloud.com/*',
          // NicoNico
          'https://www.nicovideo.jp/*',
          'https://nicovideo.jp/*',
          // Kick
          'https://kick.com/*',
          'https://www.kick.com/*',
          // Bandcamp
          'https://bandcamp.com/*',
          'https://*.bandcamp.com/*',
          // Mixcloud
          'https://www.mixcloud.com/*',
          'https://mixcloud.com/*'
        ]
      }
    })
  ]
})
