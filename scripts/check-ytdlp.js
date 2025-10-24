#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

/**
 * Check if yt-dlp binary exists in resources directory
 * Usage: node scripts/check-ytdlp.js [platform]
 * Platform options: win, mac, linux
 * Exit with error code 1 if not found
 */
function checkYtDlpExists(platform) {
  const platformMap = {
    win: 'yt-dlp.exe',
    mac: 'yt-dlp_macos',
    linux: 'yt-dlp_linux'
  }

  const filename = platformMap[platform]
  if (!filename) {
    console.error('❌ Error: Invalid platform specified!')
    console.error('Usage: node scripts/check-ytdlp.js [win|mac|linux]')
    process.exit(1)
  }

  const ytdlpPath = path.join(__dirname, '..', 'resources', filename)

  if (!fs.existsSync(ytdlpPath)) {
    console.error(`❌ Error: resources/${filename} not found!`)
    console.error(`Please download ${filename} to the resources/ directory first.`)
    console.error('You can download it from: https://github.com/yt-dlp/yt-dlp/releases/latest')
    process.exit(1)
  }

  console.log(`✅ ${filename} found in resources/ directory`)
}

// Get platform from command line arguments
const platform = process.argv[2]

if (!platform) {
  console.error('❌ Error: Platform argument is required!')
  console.error('Usage: node scripts/check-ytdlp.js [win|mac|linux]')
  process.exit(1)
}

// Run the check
checkYtDlpExists(platform)
