# VidBee

<div align="center">
  <img src="build/icon.png" alt="VidBee icon" width="120" />
  <h3>A minimal Electron downloader for video and audio</h3>
  <p>Built with Electron, React, TypeScript, Tailwind CSS, and shadcn/ui.</p>
</div>

## Features
- Download single videos, audio-only tracks, or entire playlists through a unified flow.
- Queue multiple jobs with progress tracking, pause, resume, retry, and download history.
- Detect platform-friendly formats automatically and store files in custom locations.
- Quick actions for popular sites plus manual URL entry for anything yt-dlp supports.
- Theme toggle (system, light, dark) and localized interface in English and Simplified Chinese.
- Desktop-native touches such as tray integration, update checks, and persistent settings.

## Tech Stack
- **Runtime:** Electron 38, electron-vite, electron-builder.
- **Frontend:** React 19, React Router, Jotai, React Hook Form, Tailwind CSS 4, shadcn/ui, Lucide icons.
- **Tooling:** TypeScript 5, pnpm, Biome, dayjs, electron-log, electron-store, electron-updater, i18next, next-themes.

## Getting Started
### Prerequisites
- Node.js 18 or newer
- pnpm 8 or newer

### Install dependencies
```bash
pnpm install
```

### Run the app in development
```bash
pnpm dev
```

The Electron app and Vite dev server launch together with hot module replacement.

## Useful Scripts
| Command | Description |
| --- | --- |
| `pnpm dev` | Run the Electron and Vite development environment. |
| `pnpm start` | Preview the production build locally. |
| `pnpm run typecheck` | Type-check the main and renderer projects. |
| `pnpm build` | Run type checks and produce production bundles. |
| `pnpm build:win` / `pnpm build:mac` / `pnpm build:linux` | Create platform-specific distributables. |
| `pnpm build:unpack` | Produce unpacked output directories. |
| `pnpm run check` | Format and lint the codebase with Biome. |

## Project Structure
```
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

## Internationalization
The renderer uses i18next with English (`en`) and Simplified Chinese (`zh-CN`) namespaces. Update strings in `src/renderer/src/locales/en.json`; other locales are maintained separately.

## Configuration and Storage
- Persistent settings are stored with `electron-store` and exposed through IPC helpers.
- User-facing preferences such as download paths and themes live in `src/main/settings.ts` and related services.
- Logs are recorded with `electron-log` to simplify troubleshooting.

## Packaging
Run one of the following commands after a successful build:

```bash
pnpm build:win
pnpm build:mac
pnpm build:linux
```

Artifacts are generated under `dist/`. Use `pnpm build:unpack` to create unpacked directories for manual inspection.

## Contributing
Issues and pull requests are welcome. Keep changes focused, document user facing updates, and run `pnpm run check` before opening a PR.

## License
This project is distributed under the MIT License. See `LICENSE` for details.

## Thanks
- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
