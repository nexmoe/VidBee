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

### Note

- If you don't place binaries here, the app will attempt to download them at runtime
- The app will automatically use the bundled version if available
- File sizes: ~10-15 MB per binary
