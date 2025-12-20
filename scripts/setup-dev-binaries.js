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
const DENO_BASE_URL = 'https://github.com/denoland/deno/releases/latest/download'
const GITHUB_TOKEN =
  process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_API_TOKEN

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
      extract: 'unzip',
      release: {
        repos: ['yt-dlp/FFmpeg-Builds', 'BtbN/FFmpeg-Builds'],
        assetPattern: /win64.*gpl.*\.zip$/i,
        binaryName: 'ffmpeg.exe'
      }
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
        extract: 'unzip',
        release: {
          repo: 'eko5624/mpv-mac',
          assetPattern: /ffmpeg-arm64.*\.zip$/i
        }
      },
      x64: {
        url: 'https://github.com/eko5624/mpv-mac/releases/download/2025-10-25/ffmpeg-x86_64-defd5f3f64.zip',
        innerPath: 'ffmpeg/ffmpeg',
        output: 'ffmpeg_macos',
        extract: 'unzip',
        release: {
          repo: 'eko5624/mpv-mac',
          assetPattern: /ffmpeg-x86_64.*\.zip$/i
        }
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
      extract: 'tar',
      release: {
        repos: ['yt-dlp/FFmpeg-Builds', 'BtbN/FFmpeg-Builds'],
        assetPattern: /linux64.*gpl.*\.tar\.xz$/i,
        binaryName: 'ffmpeg'
      }
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

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    const headers = {
      'User-Agent': 'vidbee-setup',
      Accept: 'application/vnd.github+json'
    }
    if (GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${GITHUB_TOKEN}`
    }

    protocol
      .get(url, { headers }, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          return fetchJson(response.headers.location).then(resolve).catch(reject)
        }
        if (response.statusCode !== 200) {
          return reject(new Error(`Failed to fetch ${url}: ${response.statusCode}`))
        }

        let body = ''
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => {
          try {
            resolve(JSON.parse(body))
          } catch (error) {
            reject(new Error(`Failed to parse JSON from ${url}: ${error.message}`))
          }
        })
      })
      .on('error', (err) => {
        reject(err)
      })
  })
}

function inferFfmpegInnerPath(assetName, binaryName) {
  if (!assetName) {
    return null
  }
  const match = assetName.match(/^(.*)\.(tar\.xz|zip)$/i)
  if (!match) {
    return null
  }
  return `${match[1]}/bin/${binaryName}`
}

async function resolveReleaseAsset(release) {
  if (!release) {
    return null
  }
  const repoCandidates = release.repos ?? (release.repo ? [release.repo] : [])
  if (repoCandidates.length === 0) {
    return null
  }

  let lastError
  for (const repo of repoCandidates) {
    try {
      const data = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`)
      const assets = Array.isArray(data.assets) ? data.assets : []
      const match = assets.find((asset) => asset?.name && release.assetPattern.test(asset.name))
      if (match?.browser_download_url) {
        return { name: match.name, url: match.browser_download_url }
      }
      lastError = new Error(`No matching assets found in ${repo}`)
    } catch (error) {
      lastError = error
    }
  }

  if (lastError) {
    throw lastError
  }
  return null
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

function getDenoAssetName(platform, arch) {
  if (platform === 'win32') {
    if (arch === 'arm64') {
      return 'deno-aarch64-pc-windows-msvc.zip'
    }
    return 'deno-x86_64-pc-windows-msvc.zip'
  }
  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return 'deno-aarch64-apple-darwin.zip'
    }
    return 'deno-x86_64-apple-darwin.zip'
  }
  if (platform === 'linux') {
    if (arch === 'arm64') {
      return 'deno-aarch64-unknown-linux-gnu.zip'
    }
    return 'deno-x86_64-unknown-linux-gnu.zip'
  }
  return null
}

function getDenoOutputName(platform) {
  return platform === 'win32' ? 'deno.exe' : 'deno'
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
  const { url: fallbackUrl, innerPath: fallbackInnerPath, output, release } = config.ffmpeg
  const outputPath = path.join(RESOURCES_DIR, output)

  if (fileExists(outputPath)) {
    log(`${output} already exists, skipping download`, 'info')
    return
  }

  log(`Downloading ffmpeg for Windows...`, 'download')
  const tempZip = path.join(RESOURCES_DIR, 'ffmpeg-temp.zip')
  const extractDir = path.join(RESOURCES_DIR, 'ffmpeg-temp')
  let downloadUrl = fallbackUrl
  let innerPath = fallbackInnerPath

  if (release) {
    try {
      const resolved = await resolveReleaseAsset(release)
      if (resolved) {
        downloadUrl = resolved.url
        const inferred = inferFfmpegInnerPath(resolved.name, release.binaryName ?? 'ffmpeg.exe')
        if (inferred) {
          innerPath = inferred
        }
      }
    } catch (error) {
      log(`Failed to resolve latest ffmpeg asset: ${error.message}`, 'warn')
    }
  }

  try {
    await downloadFile(downloadUrl, tempZip)
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

  const { url: fallbackUrl, innerPath, output, release } = ffmpegConfig
  const outputPath = path.join(RESOURCES_DIR, output)

  if (fileExists(outputPath)) {
    log(`${output} already exists, skipping download`, 'info')
    return
  }

  log(`Downloading ffmpeg for macOS (${arch})...`, 'download')
  const tempZip = path.join(RESOURCES_DIR, 'ffmpeg-temp.zip')
  const extractDir = path.join(RESOURCES_DIR, 'ffmpeg-temp')
  let downloadUrl = fallbackUrl

  if (release) {
    try {
      const resolved = await resolveReleaseAsset(release)
      if (resolved) {
        downloadUrl = resolved.url
      }
    } catch (error) {
      log(`Failed to resolve latest ffmpeg asset: ${error.message}`, 'warn')
    }
  }

  try {
    await downloadFile(downloadUrl, tempZip)
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
  const { url: fallbackUrl, innerPath: fallbackInnerPath, output, release } = config.ffmpeg
  const outputPath = path.join(RESOURCES_DIR, output)

  if (fileExists(outputPath)) {
    log(`${output} already exists, skipping download`, 'info')
    return
  }

  log(`Downloading ffmpeg for Linux...`, 'download')
  const tempTar = path.join(RESOURCES_DIR, 'ffmpeg-temp.tar.xz')
  const extractDir = path.join(RESOURCES_DIR, 'ffmpeg-temp')
  let downloadUrl = fallbackUrl
  let innerPath = fallbackInnerPath

  if (release) {
    try {
      const resolved = await resolveReleaseAsset(release)
      if (resolved) {
        downloadUrl = resolved.url
        const inferred = inferFfmpegInnerPath(resolved.name, release.binaryName ?? 'ffmpeg')
        if (inferred) {
          innerPath = inferred
        }
      }
    } catch (error) {
      log(`Failed to resolve latest ffmpeg asset: ${error.message}`, 'warn')
    }
  }

  try {
    await downloadFile(downloadUrl, tempTar)
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

async function downloadDenoRuntime() {
  const platform = os.platform()
  const arch = os.arch()
  const assetName = getDenoAssetName(platform, arch)

  if (!assetName) {
    log(`Skipping Deno runtime: unsupported platform/arch ${platform}/${arch}`, 'warn')
    return
  }

  const outputName = getDenoOutputName(platform)
  const outputPath = path.join(RESOURCES_DIR, outputName)

  if (fileExists(outputPath)) {
    log(`${outputName} already exists, skipping download`, 'info')
    return
  }

  log(`Downloading Deno runtime (${platform}/${arch})...`, 'download')
  const tempZip = path.join(RESOURCES_DIR, 'deno-temp.zip')
  const extractDir = path.join(RESOURCES_DIR, 'deno-temp')
  const downloadUrl = `${DENO_BASE_URL}/${assetName}`

  try {
    await downloadFile(downloadUrl, tempZip)
    log('Extracting Deno runtime...', 'info')
    extractZip(tempZip, extractDir)

    const sourcePath = path.join(extractDir, outputName)
    if (!fileExists(sourcePath)) {
      throw new Error(`Deno binary not found at ${sourcePath}`)
    }

    fs.copyFileSync(sourcePath, outputPath)
    setExecutable(outputPath)
    log(`Downloaded ${outputName} successfully`, 'success')

    fs.unlinkSync(tempZip)
    fs.rmSync(extractDir, { recursive: true, force: true })
  } catch (error) {
    if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip)
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

    // Download JS runtime (Deno)
    await downloadDenoRuntime()

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
