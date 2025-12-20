<div align="center">
  <a href="https://github.com/nexmoe/VidBee">
    <img src="build/icon.png" alt="Logo" width="80" height="80">
  </a>

  <h3>VidBee</h3>
  <p>
    <a href="https://github.com/nexmoe/VidBee/stargazers"><img src="https://img.shields.io/github/stars/nexmoe/VidBee?color=ffcb47&labelColor=black&style=flat-square&logo=github&label=Stars" /></a>
    <a href="https://github.com/nexmoe/VidBee/graphs/contributors"><img src="https://img.shields.io/github/contributors/nexmoe/VidBee?style=flat-square&logo=github&label=Contributors&labelColor=black" /></a>
    <a href="https://github.com/nexmoe/VidBee/releases"><img src="https://img.shields.io/github/downloads/nexmoe/VidBee/total?color=369eff&labelColor=black&logo=github&style=flat-square&label=Downloads" /></a>
    <a href="https://github.com/nexmoe/VidBee/releases/latest"><img src="https://img.shields.io/github/v/release/nexmoe/VidBee?color=369eff&labelColor=black&logo=github&style=flat-square&label=Latest%20Release" /></a>
    <a href="https://x.com/intent/follow?screen_name=nexmoex"><img src="https://img.shields.io/badge/Follow-blue?color=1d9bf0&logo=x&labelColor=black&style=flat-square" /></a>
    <br />
    <br />
    <a href="https://github.com/nexmoe/VidBee/releases/latest" target="_blank"><img src="screenshots/main-interface.png" alt="VidBee Desktop" width="46%"/></a>
    <a href="https://github.com/nexmoe/VidBee/releases/latest" target="_blank"><img src="screenshots/download-queue.png" alt="VidBee Download Queue" width="46%"/></a>
    <br />
    <br />
  </p>
</div>

VidBee is a modern, open-source video downloader that lets you download videos and audios from 1000+ websites worldwide. Built with Electron and powered by yt-dlp, VidBee offers a clean, intuitive interface with powerful features for all your downloading needs, including RSS auto-download automation that automatically subscribes to feeds and downloads new videos from your favorite creators in the background.

## 👋🏻 Getting Started

VidBee is currently under active development, and feedback is welcome for any [issue](https://github.com/nexmoe/VidBee/issues) encountered.

Feel free to try it using the following methods:

<a href="https://vidbee.org/download/" target="_blank"><img src="https://img.shields.io/badge/Download-VidBee-369eff?style=flat-square&logo=github&logoColor=white&labelColor=black" height="55"/></a>

### 🍎 macOS Installation Notes

After downloading and installing VidBee on macOS, you may encounter a "file is damaged" error when trying to run the application. This is due to macOS security restrictions on applications downloaded from the internet.

```bash
xattr -rd com.apple.quarantine /Applications/VidBee.app/
```

This command removes the quarantine attribute that macOS applies to applications downloaded from the internet, allowing VidBee to run properly without the "file is damaged" error.

### 🌐 Browser Script (Quick Download)

For a more convenient downloading experience, you can install the VidBee browser script to add a quick download button directly on supported video websites.

![VidBee Browser Script](screenshots/browser-script.png)

**Installation:**

1. Install a userscript manager extension:
   - [Tampermonkey](https://www.tampermonkey.net/) (Recommended)
   - [Violentmonkey](https://violentmonkey.github.io/)
   - [Greasemonkey](https://www.greasespot.net/)

2. Install the VidBee Quick Download script:
   - [Install from Greasy Fork](https://greasyfork.org/zh-CN/scripts/559595-vidbee-quick-download)

**Usage:**

After installation, when you visit supported video websites (YouTube, Bilibili, TikTok, Instagram, Twitter, etc.), a download button will appear on the page. Click the button to quickly send the video URL to VidBee desktop app for downloading.

**Supported Sites:**

The script works on popular video platforms including:

- YouTube, Bilibili, TikTok, Vimeo, Dailymotion
- Twitch, Twitter/X, Instagram, Facebook
- Reddit, SoundCloud, Niconico, Kick
- Bandcamp, Mixcloud, and more

> [!IMPORTANT]
>
> **Star Us**, You will receive all release notifications from GitHub without any delay ~

<a href="https://next.ossinsight.io/widgets/official/compose-last-28-days-stats?repo_id=1081230042" target="_blank" style="display: block" align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://next.ossinsight.io/widgets/official/compose-last-28-days-stats/thumbnail.png?repo_id=1081230042&image_size=auto&color_scheme=dark" width="655" height="auto">
    <img alt="Performance Stats of nexmoe/VidBee - Last 28 days" src="https://next.ossinsight.io/widgets/official/compose-last-28-days-stats/thumbnail.png?repo_id=1081230042&image_size=auto&color_scheme=light" width="655" height="auto">
  </picture>
</a>

<!-- Made with [OSS Insight](https://ossinsight.io/) -->

## ✨ Features

### 🌍 Global Video Download Support

Download videos from almost any website worldwide through the powerful yt-dlp engine. Support for 1000+ sites including YouTube, TikTok, Instagram, Twitter, and many more.

![VidBee Main Interface](screenshots/main-interface.png)

### 🎨 Best-in-class UI Experience

Modern, clean interface with intuitive operations. One-click pause/resume/retry, real-time progress tracking, and comprehensive download queue management.

![VidBee Download Queue](screenshots/download-queue.png)

### 📡 RSS Auto Download

Automatically subscribe to RSS feeds and auto-download new videos in the background from your favorite creators across YouTube, TikTok, and more. Set up RSS subscriptions once, and VidBee will automatically download new uploads without manual intervention, perfect for keeping up with your favorite channels and creators.

## 🌐 Supported Sites

VidBee supports hundreds of video and audio platforms through yt-dlp. Here are the most popular platforms:

| Video Platforms | Audio & Other Platforms |
| :--------------- | :---------------------- |
| YouTube          | YouTube Music           |
| TikTok           | SoundCloud              |
| Facebook         | Mixcloud                |
| Instagram        | Bandcamp                |
| X (Twitter)      | Reddit                  |
| Vimeo            |                         |
| Dailymotion      |                         |
| Twitch           |                         |
| LinkedIn         |                         |
| Pinterest        |                         |
| Tumblr           |                         |
| Niconico         |                         |
| Kick             |                         |

> **💡 Note:** VidBee uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) under the hood, which supports 1000+ sites. For the complete list, visit the [yt-dlp supported sites documentation](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).

## 🤝 Contributing

You are welcome to join the open source community to build together. Please check our [Contributing Guide](./CONTRIBUTING.md) for more details.

## 📄 License

This project is distributed under the MIT License. See [`LICENSE`](LICENSE) for details.

## 🙏 Thanks

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - The powerful video downloader engine
- [FFmpeg](https://ffmpeg.org/) - The multimedia framework for video and audio processing
- [Electron](https://www.electronjs.org/) - Build cross-platform desktop apps
- [React](https://react.dev/) - The UI library
- [Vite](https://vitejs.dev/) - Next generation frontend tooling
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework
- [shadcn/ui](https://ui.shadcn.com/) - Beautifully designed components
