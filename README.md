# 🐝 VidBee

<div align="center">
  <img src="build/icon.png" alt="VidBee icon" width="120" />
  <h3>Download videos from almost any website worldwide</h3>
  <p>Best-in-class UI interface - Clean, intuitive, and powerful</p>
  <p>Built with Electron, React, TypeScript, Tailwind CSS, and shadcn/ui.</p>
</div>

## ✨ Core Features

### 🌍 Global Video Download Support

- **1000+ Sites Supported** - Download videos from almost any website worldwide through yt-dlp engine
- **Smart Platform Detection** - Automatically detect video platforms and optimize download parameters
- **Multi-format Support** - Videos, audio tracks, playlists to meet all download needs

### 🎨 Best-in-class UI Experience

- **Modern Design** - Clean and beautiful interface
- **Intuitive Operations** - One-click pause/resume/retry
- **Real-time Progress** - Detailed download progress tracking and status management
- **Theme Switching** - Support for system/light/dark themes for comfortable viewing

### ⚡ Powerful Features

- 🎯 Automatically detect platform-friendly formats and store files in custom locations
- 🎨 Localized interface support in many languages

## 📥 Download & Install

1. **Download the latest release** from [GitHub Releases](https://github.com/nexmoe/VidBee/releases)
2. **Choose your platform**:
   - **Windows**: Download `vidbee-x.x.x-setup.exe`
   - **macOS**: Download `vidbee-x.x.x.dmg`
   - **Linux**: Download `vidbee-x.x.x.AppImage`
3. **Install and run** the application

## 📸 Screenshots

![VidBee Main Interface](screenshots/main-interface.png)
*Clean and intuitive interface with download queue management*

![VidBee Download Queue](screenshots/download-queue.png)
*Comprehensive download queue with progress tracking and status management*

## 🌐 Supported Sites

VidBee supports hundreds of video and audio platforms through yt-dlp. Here are the most popular platforms:

### 🎬 Video Platforms

- **📺 YouTube** - Long-form and livestream video from creators worldwide
- **🎵 TikTok** - Short-form mobile videos, effects, and live streams
- **📘 Facebook** - Feed, Watch, and Reels videos from public pages
- **📷 Instagram** - Feed, Stories, Reels, and Highlights content
- **🐦 X (Twitter)** - Timeline posts, Spaces recordings, and broadcasts
- **🎥 Vimeo** - High-quality creator and business video hosting
- **🌍 Dailymotion** - Global news, sports, and entertainment clips
- **🎮 Twitch** - Gaming, music, and IRL live streams and VODs
- **💼 LinkedIn** - Professional talks, webinars, and learning videos
- **📌 Pinterest** - Idea pins, how-to reels, and lifestyle inspiration videos
- **🎨 Tumblr** - Creative short-form media and fan edits
- **🇯🇵 Niconico** - Japanese animation, music, and live broadcast archive
- **⚡ Kick** - Creator live streams and replays on the Kick platform

### 🎵 Audio Platforms

- **🎶 YouTube Music** - Official music videos, albums, and live performances
- **🎧 SoundCloud** - Music tracks, playlists, and DJ sets
- **🎛️ Mixcloud** - DJ mixes, radio shows, and long-form audio
- **🎸 Bandcamp** - Independent artist albums and community releases

### 🔗 Other Platforms

- **🤖 Reddit** - Embedded clips and hosted videos from communities

> **💡 Note:** VidBee uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) under the hood, which supports 1000+ sites. For the complete list, visit the [yt-dlp supported sites documentation](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).

## 🛠️ Tech Stack

- **Runtime:** Electron 38, electron-vite, electron-builder
- **Frontend:** React 19, React Router, Jotai, React Hook Form, Tailwind CSS 4, shadcn/ui, Lucide icons
- **Tooling:** TypeScript 5, pnpm, Biome, dayjs, electron-log, electron-store, electron-updater, i18next, next-themes

## 🛠️ Development Setup

### 📋 Prerequisites

- Node.js 18 or newer
- pnpm 8 or newer

### 📦 Install dependencies

```bash
pnpm install
```

### 🏃‍♂️ Run the app in development

```bash
pnpm dev
```

The Electron app and Vite dev server launch together with hot module replacement.

## 📜 Useful Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Run the Electron and Vite development environment |
| `pnpm start` | Preview the production build locally |
| `pnpm run typecheck` | Type-check the main and renderer projects |
| `pnpm build` | Run type checks and produce production bundles |
| `pnpm build:win` / `pnpm build:mac` / `pnpm build:linux` | Create platform-specific distributables |
| `pnpm build:unpack` | Produce unpacked output directories |
| `pnpm run check` | Format and lint the codebase with Biome |

## 📁 Project Structure

```text
src/
├─ main/            # Electron main process, IPC services, configuration
├─ preload/         # Context bridge and preload helpers
└─ renderer/
   ├─ src/
   │  ├─ pages/      # Application routes (Home, Settings, Playlist, etc.)
   │  ├─ components/ # UI components, download views, shared controls
   │  ├─ data/       # Static datasets such as popularSites.ts
   │  ├─ hooks/      # Custom hooks and global atoms
   │  ├─ lib/        # Utilities shared across the renderer
   │  └─ assets/     # Global styles and icons
   └─ index.html
```

## 🌍 Internationalization

The renderer uses i18next with English (`en`) and Simplified Chinese (`zh-CN`) namespaces. Update strings in `src/renderer/src/locales/en.json`; other locales are maintained separately.

## ⚙️ Configuration and Storage

- Persistent settings are stored with `electron-store` and exposed through IPC helpers
- User-facing preferences such as download paths and themes live in `src/main/settings.ts` and related services
- Logs are recorded with `electron-log` to simplify troubleshooting

## 📦 Packaging

Run one of the following commands after a successful build:

```bash
pnpm build:win
pnpm build:mac
pnpm build:linux
```

Artifacts are generated under `dist/`. Use `pnpm build:unpack` to create unpacked directories for manual inspection.

## 🤝 Contributing

Issues and pull requests are welcome. Keep changes focused, document user facing updates, and run `pnpm run check` before opening a PR.

## 📄 License

This project is distributed under the MIT License. See `LICENSE` for details.

## 🙏 Thanks

- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
