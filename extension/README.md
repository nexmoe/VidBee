# VidBee Video Downloader Extension

VidBee Video Downloader is a lightweight browser companion for the VidBee desktop app. It detects the video on your current tab, shows the available formats, and hands the URL to VidBee so the download happens in the desktop app instead of your browser.

## Why install it?

- **One-click handoff:** Send the current video page to VidBee without copy-pasting links.
- **See formats before downloading:** Preview resolutions, file sizes, and audio-only options in the popup.
- **More reliable downloads:** VidBee handles large files and multi-format downloads better than most browsers.
- **Works on 1,000+ sites:** The extension uses the same site support as the VidBee app.

## What it does

1. Reads the active tab URL when you open the popup.
2. Asks the VidBee desktop app (running locally) to analyze the video.
3. Displays the formats it finds and lets you open VidBee to download.

## Requirements

- VidBee desktop app installed.
- VidBee running while you use the extension.

## How to use

1. Open a supported video page.
2. Click the VidBee extension icon.
3. Review available formats.
4. Click **Download with VidBee** to start the download in the desktop app.

## Development

```bash
pnpm install
pnpm dev
```

Build or package:

```bash
pnpm build
pnpm zip
```

Firefox builds:

```bash
pnpm dev:firefox
pnpm build:firefox
pnpm zip:firefox
```

## Notes on privacy

The extension only sends the current tab URL to the local VidBee app on `127.0.0.1` and stores temporary results in browser storage for faster reloads.
