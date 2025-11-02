#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

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
    filenameMap: {
      win: 'yt-dlp.exe',
      mac: 'yt-dlp_macos',
      linux: 'yt-dlp_linux'
    },
    help: {
      default: 'https://github.com/yt-dlp/yt-dlp/releases/latest'
    }
  },
  {
    label: 'ffmpeg',
    filenameMap: {
      win: 'ffmpeg.exe',
      mac: 'ffmpeg_macos',
      linux: 'ffmpeg_linux'
    },
    help: {
      win: 'https://ffmpeg.org/download.html',
      linux: 'https://ffmpeg.org/download.html',
      mac: 'https://github.com/eko5624/mpv-mac/releases/latest'
    }
  }
]

let hasMissingBinary = false

for (const binary of binaries) {
  const filename = binary.filenameMap[platform]
  const binaryPath = path.join(__dirname, '..', 'resources', filename)

  if (!fs.existsSync(binaryPath)) {
    console.error(`❌ Error: resources/${filename} not found!`)
    console.error(`Please download ${filename} to the resources/ directory first.`)
    const help =
      typeof binary.help === 'string' ? binary.help : binary.help[platform] || binary.help.default
    if (help) {
      console.error(`See ${help}`)
    }
    hasMissingBinary = true
  } else {
    console.log(`✅ ${filename} found in resources/ directory`)
  }
}

if (hasMissingBinary) {
  process.exit(1)
}
