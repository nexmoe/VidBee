import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type YTDlpWrap from 'yt-dlp-wrap-plus'

// Use require for yt-dlp-wrap-plus to handle CommonJS/ESM compatibility
const YTDlpWrapModule = require('yt-dlp-wrap-plus')
const YTDlpWrapCtor: typeof YTDlpWrap = YTDlpWrapModule.default || YTDlpWrapModule
type YTDlpWrapInstance = InstanceType<typeof YTDlpWrapCtor>

class YtDlpManager {
  private ytdlpPath: string | null = null
  private ytdlpInstance: YTDlpWrapInstance | null = null

  async initialize(): Promise<void> {
    this.ytdlpPath = await this.findOrDownloadYtDlp()
    this.ytdlpInstance = new YTDlpWrapCtor(this.ytdlpPath)
    console.log('yt-dlp initialized at:', this.ytdlpPath)
  }

  getInstance(): YTDlpWrapInstance {
    if (!this.ytdlpInstance) {
      throw new Error('yt-dlp not initialized. Call initialize() first.')
    }
    return this.ytdlpInstance
  }

  getPath(): string {
    if (!this.ytdlpPath) {
      throw new Error('yt-dlp not initialized. Call initialize() first.')
    }
    return this.ytdlpPath
  }

  private getResourcesPath(): string {
    // In development, read from project root's resources
    if (process.env.NODE_ENV === 'development') {
      return path.join(process.cwd(), 'resources')
    }
    // In production, unpacked binaries live under app.asar.unpacked/resources
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'resources')
  }

  private async findOrDownloadYtDlp(): Promise<string> {
    const platform = os.platform()
    let bundledName: string

    // Determine the binary name based on platform
    if (platform === 'win32') {
      bundledName = 'yt-dlp.exe'
    } else if (platform === 'darwin') {
      bundledName = 'yt-dlp_macos'
    } else {
      bundledName = 'yt-dlp_linux'
    }

    // Check environment variable first
    if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
      console.log('Using yt-dlp from YTDLP_PATH:', process.env.YTDLP_PATH)
      return process.env.YTDLP_PATH
    }

    // Check for bundled yt-dlp in resources directory
    const resourcesPath = this.getResourcesPath()
    const bundledPath = path.join(resourcesPath, bundledName)
    if (fs.existsSync(bundledPath)) {
      console.log('Using bundled yt-dlp:', bundledPath)
      // Make executable on Unix-like systems if needed
      if (platform !== 'win32') {
        try {
          fs.chmodSync(bundledPath, 0o755)
        } catch (error) {
          console.warn('Failed to set executable permission:', error)
        }
      }
      return bundledPath
    }

    // Check for system-installed yt-dlp on macOS
    if (os.platform() === 'darwin') {
      const possiblePaths = ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp']
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          console.log('Using system yt-dlp:', p)
          return p
        }
      }
    }

    // Check for system-installed yt-dlp on Linux/FreeBSD
    if (os.platform() === 'linux' || os.platform() === 'freebsd') {
      try {
        const systemPath = execSync('which yt-dlp').toString().trim()
        if (systemPath && fs.existsSync(systemPath)) {
          console.log('Using system yt-dlp:', systemPath)
          return systemPath
        }
      } catch (_error) {
        // yt-dlp not in PATH, continue
      }
    }

    // At this point, no bundled/system binary found.
    // For Windows, we do NOT download at runtime. Require bundling.
    if (platform === 'win32') {
      throw new Error(
        'yt-dlp not found. Ensure resources/yt-dlp.exe is bundled (asarUnpack) in the build.'
      )
    }

    // For macOS/Linux, instruct user to bundle or install system yt-dlp.
    throw new Error(
      'yt-dlp not found. Bundle it under resources/ (asarUnpack) or install yt-dlp in system PATH.'
    )
  }

  // Removed runtime download/update to avoid network dependency in production builds
}

export const ytdlpManager = new YtDlpManager()
