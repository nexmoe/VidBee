# VidBee Documentation Icons

This directory contains the VidBee logo in various sizes for use in the documentation site.

## Source

All icons are generated from the original VidBee application icon located at:
`/Users/air15/Documents/GitHub/VidBee/build/icon.png`

## Available Sizes

| Filename | Size | Use Case |
|----------|------|----------|
| `icon.png` | 512×512 | Default/Original icon |
| `icon-16.png` | 16×16 | Browser favicon (small) |
| `icon-32.png` | 32×32 | Browser favicon (standard) |
| `icon-48.png` | 48×48 | Browser favicon (large) |
| `icon-64.png` | 64×64 | Small UI elements |
| `icon-128.png` | 128×128 | Medium UI elements |
| `icon-192.png` | 192×192 | PWA icon (Android) |
| `icon-256.png` | 256×256 | Large UI elements |
| `icon-512.png` | 512×512 | PWA splash screen, high-res displays |
| `apple-touch-icon.png` | 180×180 | iOS/macOS home screen icon |
| `favicon.png` | 32×32 | Standard favicon |

## Usage in Next.js

### In `app/layout.tsx` or `app/favicon.ico`:

```tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'VidBee Documentation',
  description: 'Official VidBee documentation',
  icons: {
    icon: [
      { url: '/icon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-48.png', sizes: '48x48', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
}
```

### For PWA (Progressive Web App):

Add to your `manifest.json` or `site.webmanifest`:

```json
{
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

## Regeneration

If you need to regenerate these icons from the source:

```bash
cd docs/public
SOURCE="/Users/air15/Documents/GitHub/VidBee/build/icon.png"

# Copy original
cp $SOURCE icon-original.png

# Generate sizes
sips -z 16 16 icon-original.png --out icon-16.png
sips -z 32 32 icon-original.png --out icon-32.png
sips -z 48 48 icon-original.png --out icon-48.png
sips -z 64 64 icon-original.png --out icon-64.png
sips -z 128 128 icon-original.png --out icon-128.png
sips -z 192 192 icon-original.png --out icon-192.png
sips -z 256 256 icon-original.png --out icon-256.png
sips -z 180 180 icon-original.png --out apple-touch-icon.png

# Create standard copies
cp icon-original.png icon-512.png
cp icon-original.png icon.png
cp icon-32.png favicon.png
```

## Notes

- All icons maintain the VidBee bee/honeycomb theme
- Icons use PNG format with transparency (RGBA)
- Generated using macOS `sips` tool for quality consistency
