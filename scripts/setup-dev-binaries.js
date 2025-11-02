#!/usr/bin/env node

/**
 * Development environment setup script
 * Automatically downloads yt-dlp and ffmpeg binaries based on the current system
 */

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execSync } = require('node:child_process')
const https = require('node:https')
const http = require('node:http')

// Configuration
const RESOURCES_DIR = path.join(__dirname, '..', 'resources')
const YTDLP_BASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

// Platform configuration
const PLATFORM_CONFIG = {
  win32: {
    ytdlp: {
      asset: 'yt-dlp.exe',
      output: 'yt-dlp.exe'
    },
    ffmpeg: {
      url: 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip',
      innerPath: 'ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe',
      output: 'ffmpeg.exe',
      extract: 'unzip'
    }
  },
  darwin: {
    ytdlp: {
      asset: 'yt-dlp_macos',
      output: 'yt-dlp_macos'
    },
    ffmpeg: {
      // For development, download only the architecture matching current system
      arm64: {
        url: 'https://github.com/eko5624/mpv-mac/releases/download/2025-10-25/ffmpeg-arm64-defd5f3f64.zip',
        innerPath: 'ffmpeg/ffmpeg',
        output: 'ffmpeg_macos',
        extract: 'unzip'
      },
      x64: {
        url: 'https://github.com/eko5624/mpv-mac/releases/download/2025-10-25/ffmpeg-x86_64-defd5f3f64.zip',
        innerPath: 'ffmpeg/ffmpeg',
        output: 'ffmpeg_macos',
        extract: 'unzip'
      }
    }
  },
  linux: {
    ytdlp: {
      asset: 'yt-dlp',
      output: 'yt-dlp_linux'
    },
    ffmpeg: {
      url: 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz',
      innerPath: 'ffmpeg-master-latest-linux64-gpl/bin/ffmpeg',
      output: 'ffmpeg_linux',
      extract: 'tar'
    }
  }
}

// Utility functions
function log(message, type = 'info') {
  const icons = {
    info: '📦',
    success: '✅',
    error: '❌',
    warn: '⚠️',
    download: '⬇️'
  }
  console.log(`${icons[type] || 'ℹ️'} ${message}`)
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(dest)

    protocol
      .get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          file.close()
          fs.unlinkSync(dest)
          return downloadFile(response.headers.location, dest).then(resolve).catch(reject)
        }

        if (response.statusCode !== 200) {
          file.close()
          fs.unlinkSync(dest)
          return reject(new Error(`Failed to download: ${response.statusCode}`))
        }

        response.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve()
        })
      })
      .on('error', (err) => {
        file.close()
        fs.unlinkSync(dest)
        reject(err)
      })
  })
}

function extractZip(zipPath, extractDir) {
  const platform = os.platform()
  ensureDir(extractDir)

  if (platform === 'win32') {
    // Use PowerShell Expand-Archive on Windows
    try {
      const zipAbsPath = path.resolve(zipPath)
      const extractAbsDir = path.resolve(extractDir)
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${zipAbsPath.replace(/'/g, "''")}' -DestinationPath '${extractAbsDir.replace(/'/g, "''")}' -Force"`,
        { stdio: 'inherit' }
      )
    } catch (error) {
      throw new Error(`Failed to extract zip: ${error.message}`)
    }
  } else {
    // Use unzip command on macOS/Linux
    try {
      execSync(`unzip -q "${zipPath}" -d "${extractDir}"`, { stdio: 'inherit' })
    } catch (error) {
      throw new Error(`Failed to extract zip: ${error.message}`)
    }
  }
}

function extractTarXz(tarPath, extractDir) {
  ensureDir(extractDir)
  execSync(`tar -xf "${tarPath}" -C "${extractDir}"`, { stdio: 'inherit' })
}

function setExecutable(filePath) {
  if (os.platform() !== 'win32') {
    fs.chmodSync(filePath, 0o755)
  }
}

function fileExists(filePath) {
  return fs.existsSync(filePath)
}

// Main download functions
async function downloadYtDlp(config) {
  const { asset, output } = config.ytdlp
  const outputPath = path.join(RESOURCES_DIR, output)

  if (fileExists(outputPath)) {
    log(`${output} already exists, skipping download`, 'info')
    return
  }

  log(`Downloading ${asset}...`, 'download')
  const url = `${YTDLP_BASE_URL}/${asset}`
  const tempPath = path.join(RESOURCES_DIR, `.${asset}.tmp`)

  try {
    await downloadFile(url, tempPath)
    fs.renameSync(tempPath, outputPath)
    setExecutable(outputPath)
    log(`Downloaded ${output} successfully`, 'success')
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath)
    }
    throw error
  }
}

async function downloadFfmpegWindows(config) {
  const { url, innerPath, output } = config.ffmpeg
  const outputPath = path.join(RESOURCES_DIR, output)

  if (fileExists(outputPath)) {
    log(`${output} already exists, skipping download`, 'info')
    return
  }

  log(`Downloading ffmpeg for Windows...`, 'download')
  const tempZip = path.join(RESOURCES_DIR, 'ffmpeg-temp.zip')
  const extractDir = path.join(RESOURCES_DIR, 'ffmpeg-temp')

  try {
    await downloadFile(url, tempZip)
    log('Extracting ffmpeg...', 'info')
    extractZip(tempZip, extractDir)

    const sourcePath = path.join(extractDir, innerPath.replace(/\\/g, path.sep))
    if (!fileExists(sourcePath)) {
      throw new Error(`ffmpeg binary not found at ${sourcePath}`)
    }

    fs.copyFileSync(sourcePath, outputPath)
    log(`Downloaded ${output} successfully`, 'success')

    // Cleanup
    fs.unlinkSync(tempZip)
    fs.rmSync(extractDir, { recursive: true, force: true })
  } catch (error) {
    if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip)
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true })
    throw error
  }
}

async function downloadFfmpegMac(config) {
  const arch = os.arch()
  const ffmpegConfig = config.ffmpeg[arch === 'arm64' ? 'arm64' : 'x64']

  if (!ffmpegConfig) {
    throw new Error(`Unsupported architecture: ${arch}`)
  }

  const { url, innerPath, output } = ffmpegConfig
  const outputPath = path.join(RESOURCES_DIR, output)

  if (fileExists(outputPath)) {
    log(`${output} already exists, skipping download`, 'info')
    return
  }

  log(`Downloading ffmpeg for macOS (${arch})...`, 'download')
  const tempZip = path.join(RESOURCES_DIR, 'ffmpeg-temp.zip')
  const extractDir = path.join(RESOURCES_DIR, 'ffmpeg-temp')

  try {
    await downloadFile(url, tempZip)
    log('Extracting ffmpeg...', 'info')
    extractZip(tempZip, extractDir)

    const sourcePath = path.join(extractDir, innerPath)
    if (!fileExists(sourcePath)) {
      throw new Error(`ffmpeg binary not found at ${sourcePath}`)
    }

    fs.copyFileSync(sourcePath, outputPath)
    setExecutable(outputPath)
    log(`Downloaded ${output} successfully`, 'success')

    // Cleanup
    fs.unlinkSync(tempZip)
    fs.rmSync(extractDir, { recursive: true, force: true })
  } catch (error) {
    if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip)
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true })
    throw error
  }
}

async function downloadFfmpegLinux(config) {
  const { url, innerPath, output } = config.ffmpeg
  const outputPath = path.join(RESOURCES_DIR, output)

  if (fileExists(outputPath)) {
    log(`${output} already exists, skipping download`, 'info')
    return
  }

  log(`Downloading ffmpeg for Linux...`, 'download')
  const tempTar = path.join(RESOURCES_DIR, 'ffmpeg-temp.tar.xz')
  const extractDir = path.join(RESOURCES_DIR, 'ffmpeg-temp')

  try {
    await downloadFile(url, tempTar)
    log('Extracting ffmpeg...', 'info')
    extractTarXz(tempTar, extractDir)

    const sourcePath = path.join(extractDir, innerPath)
    if (!fileExists(sourcePath)) {
      throw new Error(`ffmpeg binary not found at ${sourcePath}`)
    }

    fs.copyFileSync(sourcePath, outputPath)
    setExecutable(outputPath)
    log(`Downloaded ${output} successfully`, 'success')

    // Cleanup
    fs.unlinkSync(tempTar)
    fs.rmSync(extractDir, { recursive: true, force: true })
  } catch (error) {
    if (fs.existsSync(tempTar)) fs.unlinkSync(tempTar)
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true })
    throw error
  }
}

// Main setup function
async function setup() {
  const platform = os.platform()
  const config = PLATFORM_CONFIG[platform]

  if (!config) {
    log(`Unsupported platform: ${platform}`, 'error')
    process.exit(1)
  }

  log(`Setting up development binaries for ${platform}...`, 'info')
  ensureDir(RESOURCES_DIR)

  try {
    // Download yt-dlp
    await downloadYtDlp(config)

    // Download ffmpeg
    if (platform === 'win32') {
      await downloadFfmpegWindows(config)
    } else if (platform === 'darwin') {
      await downloadFfmpegMac(config)
    } else if (platform === 'linux') {
      await downloadFfmpegLinux(config)
    }

    log('Development environment setup completed!', 'success')
  } catch (error) {
    log(`Setup failed: ${error.message}`, 'error')
    process.exit(1)
  }
}

// Run setup
if (require.main === module) {
  setup()
}

module.exports = { setup }
