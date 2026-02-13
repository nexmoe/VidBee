#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

// Get platform from command line arguments
const platform = process.argv[2]

if (!platform) {
  console.error('❌ Error: Platform argument is required!')
  console.error('Usage: node scripts/check-ytdlp.js [win|mac|linux]')
  process.exit(1)
}

const supportedPlatforms = ['win', 'mac', 'linux']

if (!supportedPlatforms.includes(platform)) {
  console.error('❌ Error: Invalid platform specified!')
  console.error('Usage: node scripts/check-ytdlp.js [win|mac|linux]')
  process.exit(1)
}

const binaries = [
  {
    label: 'yt-dlp',
    paths: {
      win: ['yt-dlp.exe'],
      mac: ['yt-dlp_macos'],
      linux: ['yt-dlp_linux']
    },
    help: {
      default: 'https://github.com/yt-dlp/yt-dlp/releases/latest'
    }
  },
  {
    label: 'ffmpeg',
    paths: {
      win: ['ffmpeg/ffmpeg.exe'],
      mac: ['ffmpeg/ffmpeg'],
      linux: ['ffmpeg/ffmpeg']
    },
    help: {
      win: 'https://ffmpeg.org/download.html',
      linux: 'https://ffmpeg.org/download.html',
      mac: 'https://github.com/eko5624/mpv-mac/releases/latest'
    }
  },
  {
    label: 'ffprobe',
    paths: {
      win: ['ffmpeg/ffprobe.exe'],
      mac: ['ffmpeg/ffprobe'],
      linux: ['ffmpeg/ffprobe']
    },
    help: {
      win: 'https://ffmpeg.org/download.html',
      linux: 'https://ffmpeg.org/download.html',
      mac: 'https://github.com/eko5624/mpv-mac/releases/latest'
    }
  },
  {
    label: 'deno',
    paths: {
      win: ['deno.exe'],
      mac: ['deno'],
      linux: ['deno']
    },
    help: {
      default: 'https://github.com/denoland/deno/releases/latest'
    }
  }
]

let hasMissingBinary = false

for (const binary of binaries) {
  const candidates = binary.paths[platform] || []
  const found = candidates.find((filename) =>
    fs.existsSync(path.join(scriptDir, '..', 'resources', filename))
  )

  if (found) {
    console.log(`✅ ${binary.label} found: resources/${found}`)
  } else {
    const expected = candidates.length ? candidates.join(' or ') : binary.label
    console.error(`❌ Error: resources/${expected} not found!`)
    console.error(`Please download ${binary.label} to the resources/ directory first.`)
    const help =
      typeof binary.help === 'string' ? binary.help : binary.help[platform] || binary.help.default
    if (help) {
      console.error(`See ${help}`)
    }
    hasMissingBinary = true
  }
}

if (hasMissingBinary) {
  process.exit(1)
}
