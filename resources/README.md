# Resources Directory

This directory contains bundled resources for the application.

## yt-dlp Binaries

To bundle yt-dlp with the application, place the appropriate binaries in this directory:

### Required Files

1. **Windows**: `yt-dlp.exe`
2. **macOS**: `yt-dlp_macos`
3. **Linux**: `yt-dlp_linux`

### How to Download

You can download the latest yt-dlp binaries from the official GitHub releases:

**Option 1: Manual Download**

- Visit: <https://github.com/yt-dlp/yt-dlp/releases/latest>
- Download the appropriate version for each platform:
  - Windows: `yt-dlp.exe`
  - macOS: `yt-dlp_macos`
  - Linux: `yt-dlp` (rename to `yt-dlp_linux`)

**Option 2: Using curl/wget (Linux/macOS)**

```bash
# For Windows binary
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe -o resources/yt-dlp.exe

# For macOS binary
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos -o resources/yt-dlp_macos
chmod +x resources/yt-dlp_macos

# For Linux binary
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o resources/yt-dlp_linux
chmod +x resources/yt-dlp_linux
```

**Option 3: Using PowerShell (Windows)**

```powershell
# Download all three binaries
Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile "resources/yt-dlp.exe"
Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos" -OutFile "resources/yt-dlp_macos"
Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -OutFile "resources/yt-dlp_linux"
```

## ffmpeg Binaries

ffmpeg is required for merging audio/video streams and audio extraction. Bundle the matching binary for each target platform:

### Required Files

1. **Windows**: `ffmpeg.exe`
2. **macOS**: `ffmpeg_macos`
3. **Linux**: `ffmpeg_linux`

### How to Download

- **Windows / Linux**: Grab static builds from <https://ffmpeg.org/download.html> (or <https://github.com/yt-dlp/FFmpeg-Builds/releases>) and rename the binary to match the filenames above.
- **macOS**: Download the `ffmpeg-arm64*.zip` and `ffmpeg-x86_64*.zip` assets from <https://github.com/eko5624/mpv-mac/releases/latest>. Extract them and merge into a universal binary with `lipo -create`, then save the result as `resources/ffmpeg_macos`.
- On macOS/Linux ensure the final binary is executable: `chmod +x resources/ffmpeg_macos` (or `ffmpeg_linux`).

### Note

- Bundled binaries are required for Windows builds. On macOS/Linux the app can also use ffmpeg/yt-dlp from the system PATH.
- You can override the lookup paths via the `YTDLP_PATH` or `FFMPEG_PATH` environment variables if you prefer custom locations.
- File sizes: ~10-15 MB per yt-dlp binary, ~40-80 MB per ffmpeg binary

## JS Runtime (Deno)

yt-dlp uses an external JS runtime (Deno by default) for some extractors. Bundle a Deno binary so the app can run without system dependencies.

### Required Files

1. **Windows**: `deno.exe`
2. **macOS**: `deno`
3. **Linux**: `deno`

### How to Download

- Visit: <https://github.com/denoland/deno/releases/latest>
- Download the matching platform archive and extract the `deno` (or `deno.exe`) binary into `resources/`.
- On macOS/Linux ensure the file is executable: `chmod +x resources/deno`

### Note

- You can override the runtime path via `YTDLP_JS_RUNTIME_PATH` if needed.
