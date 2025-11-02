# Contributing to VidBee

Thank you for taking the time to improve VidBee. These notes keep the project maintainable and easy to review.

## Getting Ready
- Use Node.js 18+ and pnpm 8+.
- Install dependencies with `pnpm install`.
- Run `pnpm dev` to test changes locally.

## Tech Stack
- Runtime: Electron 38, electron-vite, electron-builder.
- Frontend: React 19, React Router, Jotai, React Hook Form, Tailwind CSS 4, shadcn/ui, Lucide icons.
- Tooling: TypeScript 5, pnpm, Biome, dayjs, electron-log, electron-store, electron-updater, i18next, next-themes.

## Local Development
- Use `pnpm install` to pull dependencies after cloning.
- Start the Electron and Vite development environment with `pnpm dev`; hot module replacement is already configured.
- Preview the production build locally with `pnpm start`.

## Useful Scripts

| Command | Purpose |
| --- | --- |
| `pnpm run typecheck` | Type-check the main and renderer projects. |
| `pnpm build` | Run type checks and produce production bundles. |
| `pnpm build:win` / `pnpm build:mac` / `pnpm build:linux` | Create platform-specific distributables. |
| `pnpm build:unpack` | Produce unpacked output directories for inspection. |
| `pnpm run check` | Format and lint the codebase with Biome. |

## Project Structure

```text
src/
|-- main/            # Electron main process, IPC services, configuration
|-- preload/         # Context bridge and preload helpers
`-- renderer/
    |-- src/
    |   |-- pages/      # Application routes (Home, Settings, Playlist, etc.)
    |   |-- components/ # UI components, download views, shared controls
    |   |-- data/       # Static datasets such as popularSites.ts
    |   |-- hooks/      # Custom hooks and global atoms
    |   |-- lib/        # Utilities shared across the renderer
    |   `-- assets/     # Global styles and icons
    `-- index.html
```

## Internationalization
- i18next drives localization with English (`en`) and Simplified Chinese (`zh-CN`) namespaces.
- Only update strings in `src/renderer/src/locales/en.json`; maintainers handle the other locales.
- Keep copy edits focused and avoid removing translation keys without discussion.

## Configuration and Storage
- Persistent settings are stored with `electron-store` and exposed through IPC helpers.
- User-facing preferences such as download paths and themes live in `src/main/settings.ts` and related services.
- Logs are recorded with `electron-log` to simplify troubleshooting.

## Packaging
- Build production bundles with `pnpm build`.
- Create platform-specific artifacts with `pnpm build:win`, `pnpm build:mac`, or `pnpm build:linux`.
- Use `pnpm build:unpack` to generate unpacked directories under `dist/` for manual inspection.
- Bundle platform binaries of `yt-dlp` and `ffmpeg` under `resources/` (or set `YTDLP_PATH`/`FFMPEG_PATH`) before packaging so merges and audio extraction work out of the box.

## Working on Changes
- Keep each pull request focused on a single problem or feature.
- Run `pnpm run check` before committing to ensure formatting and linting stay consistent.
- Write comments and console messages in English only.
- When updating copy in the app, adjust strings in `src/renderer/src/locales/en.json`; other locale files are handled by maintainers.

## Opening Issues
- Search existing issues to avoid duplicates.
- Describe the problem clearly with steps to reproduce, expected behaviour, and screenshots or logs when useful.

## Submitting Pull Requests
- Explain the motivation and impact of the change in the description.
- Mention any user facing updates or migrations.
- Confirm that `pnpm run check` passes and note any follow-up work that is out of scope.

We appreciate every contribution that keeps VidBee simple and reliable.
