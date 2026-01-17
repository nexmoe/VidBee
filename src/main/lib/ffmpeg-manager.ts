import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scopedLoggers } from '../utils/logger'

class FfmpegManager {
  private ffmpegPath: string | null = null

  async initialize(): Promise<void> {
    this.ffmpegPath = await this.findFfmpegBinary()
    scopedLoggers.engine.info('ffmpeg initialized at:', this.ffmpegPath)
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
    const ffmpegFileName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const ffprobeFileName = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'

    const resolveBundledFfmpeg = (dirPath: string, label: string): string | null => {
      const ffmpegPath = path.join(dirPath, ffmpegFileName)
      const ffprobePath = path.join(dirPath, ffprobeFileName)
      if (!fs.existsSync(ffmpegPath) || !fs.existsSync(ffprobePath)) {
        return null
      }
      if (platform !== 'win32') {
        try {
          fs.chmodSync(ffmpegPath, 0o755)
          fs.chmodSync(ffprobePath, 0o755)
        } catch (error) {
          scopedLoggers.engine.warn(`Failed to set executable permission on ${label}:`, error)
        }
      }
      scopedLoggers.engine.info(`Using ${label}:`, ffmpegPath)
      return ffmpegPath
    }

    const envPath = process.env.FFMPEG_PATH
    if (envPath) {
      if (!fs.existsSync(envPath)) {
        throw new Error(
          'FFMPEG_PATH does not exist. Provide a directory containing ffmpeg and ffprobe.'
        )
      }
      const stats = fs.statSync(envPath)
      if (!stats.isDirectory()) {
        throw new Error('FFMPEG_PATH must be a directory containing ffmpeg and ffprobe.')
      }
      const resolved = resolveBundledFfmpeg(envPath, 'ffmpeg from FFMPEG_PATH directory')
      if (resolved) {
        return resolved
      }
      throw new Error('FFMPEG_PATH must contain both ffmpeg and ffprobe.')
    }

    const resourcesPath = this.getResourcesPath()
    const bundledDir = path.join(resourcesPath, 'ffmpeg')
    const bundledResolved = resolveBundledFfmpeg(bundledDir, 'bundled ffmpeg')
    if (bundledResolved) {
      return bundledResolved
    }

    if (platform === 'darwin') {
      const commonDirs = ['/opt/homebrew/bin', '/usr/local/bin']
      for (const candidate of commonDirs) {
        const resolved = resolveBundledFfmpeg(candidate, 'system ffmpeg')
        if (resolved) {
          return resolved
        }
      }
    }

    if (platform === 'linux' || platform === 'freebsd') {
      try {
        const systemPath = execSync('which ffmpeg').toString().trim()
        if (systemPath && fs.existsSync(systemPath)) {
          const resolved = resolveBundledFfmpeg(path.dirname(systemPath), 'system ffmpeg')
          if (resolved) {
            return resolved
          }
        }
      } catch (_error) {
        // Ignore error and continue
      }
    }

    if (platform === 'win32') {
      try {
        const output = execSync('where ffmpeg').toString().split(/\r?\n/)[0]
        if (output && fs.existsSync(output)) {
          const resolved = resolveBundledFfmpeg(path.dirname(output), 'system ffmpeg')
          if (resolved) {
            return resolved
          }
        }
      } catch (_error) {
        // Ignore error and continue
      }
    }

    throw new Error(
      'ffmpeg/ffprobe not found. Bundle them under resources/ffmpeg/ (asarUnpack) or set FFMPEG_PATH to a directory containing both.'
    )
  }
}

export const ffmpegManager = new FfmpegManager()
