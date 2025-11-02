import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

class FfmpegManager {
  private ffmpegPath: string | null = null

  async initialize(): Promise<void> {
    this.ffmpegPath = await this.findFfmpegBinary()
    console.log('ffmpeg initialized at:', this.ffmpegPath)
  }

  getPath(): string {
    if (!this.ffmpegPath) {
      throw new Error('ffmpeg not initialized. Call initialize() first.')
    }
    return this.ffmpegPath
  }

  private getResourcesPath(): string {
    if (process.env.NODE_ENV === 'development') {
      return path.join(process.cwd(), 'resources')
    }
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'resources')
  }

  private async findFfmpegBinary(): Promise<string> {
    const platform = os.platform()
    const resourceCandidates: string[] = []

    if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
      console.log('Using ffmpeg from FFMPEG_PATH:', process.env.FFMPEG_PATH)
      return process.env.FFMPEG_PATH
    }

    if (platform === 'win32') {
      resourceCandidates.push('ffmpeg.exe')
    } else if (platform === 'darwin') {
      resourceCandidates.push('ffmpeg_macos', 'ffmpeg')
    } else {
      resourceCandidates.push('ffmpeg_linux', 'ffmpeg')
    }

    const resourcesPath = this.getResourcesPath()
    for (const candidate of resourceCandidates) {
      const fullPath = path.join(resourcesPath, candidate)
      if (fs.existsSync(fullPath)) {
        if (platform !== 'win32') {
          try {
            fs.chmodSync(fullPath, 0o755)
          } catch (error) {
            console.warn('Failed to set executable permission on ffmpeg binary:', error)
          }
        }
        console.log('Using bundled ffmpeg:', fullPath)
        return fullPath
      }
    }

    if (platform === 'darwin') {
      const commonPaths = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']
      for (const candidate of commonPaths) {
        if (fs.existsSync(candidate)) {
          console.log('Using system ffmpeg:', candidate)
          return candidate
        }
      }
    }

    if (platform === 'linux' || platform === 'freebsd') {
      try {
        const systemPath = execSync('which ffmpeg').toString().trim()
        if (systemPath && fs.existsSync(systemPath)) {
          console.log('Using system ffmpeg:', systemPath)
          return systemPath
        }
      } catch (_error) {
        // Ignore error and continue
      }
    }

    if (platform === 'win32') {
      try {
        const output = execSync('where ffmpeg').toString().split(/\r?\n/)[0]
        if (output && fs.existsSync(output)) {
          console.log('Using system ffmpeg:', output)
          return output
        }
      } catch (_error) {
        // Ignore error and continue
      }
    }

    throw new Error(
      'ffmpeg not found. Bundle it under resources/ (asarUnpack) or set the FFMPEG_PATH environment variable.'
    )
  }
}

export const ffmpegManager = new FfmpegManager()
