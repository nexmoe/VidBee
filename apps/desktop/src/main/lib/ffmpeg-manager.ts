import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scopedLoggers } from '../utils/logger'
import { resolveBundledResourcesPath } from './bundled-resources-path'

/**
 * Manage ffmpeg and ffprobe discovery for packaged and development builds.
 */
class FfmpegManager {
  private ffmpegPath: string | null = null
  private initializePromise: Promise<string> | null = null

  /**
   * Resolves and caches the ffmpeg binary path for the current runtime.
   */
  async initialize(): Promise<void> {
    this.ffmpegPath = await this.findFfmpegBinary()
    this.initializePromise = null
    scopedLoggers.engine.info('ffmpeg initialized at:', this.ffmpegPath)
  }

  /**
   * Returns the cached ffmpeg binary path after successful initialization.
   */
  getPath(): string {
    if (!this.ffmpegPath) {
      throw new Error('ffmpeg not initialized. Call initialize() first.')
    }
    return this.ffmpegPath
  }

  /**
   * Report whether ffmpeg is usable, attempting a lazy initialization if needed.
   */
  async isReady(): Promise<boolean> {
    try {
      await this.ensureInitialized()
      return true
    } catch {
      return false
    }
  }

  /**
   * Ensures ffmpeg is initialized and preserves the original lookup failure.
   */
  async ensureInitialized(): Promise<string> {
    if (this.ffmpegPath) {
      return this.ffmpegPath
    }

    if (!this.initializePromise) {
      this.initializePromise = this.findFfmpegBinary()
        .then((resolvedPath) => {
          this.ffmpegPath = resolvedPath
          scopedLoggers.engine.info('ffmpeg initialized at:', resolvedPath)
          return resolvedPath
        })
        .finally(() => {
          this.initializePromise = null
        })
    }

    return this.initializePromise
  }

  /**
   * Resolves the resources directory for packaged and development builds.
   */
  private getResourcesPath(): string {
    return resolveBundledResourcesPath(['ffmpeg'])
  }

  /**
   * Resolve the bundled ffmpeg binary, validating that ffprobe is colocated.
   *
   * The desktop app deliberately uses ONLY its shipped ffmpeg/ffprobe (under
   * resources/ffmpeg/). FFMPEG_PATH and any system install are ignored so the
   * runtime behaves identically everywhere and can't break on an incompatible
   * system ffmpeg.
   */
  private async findFfmpegBinary(): Promise<string> {
    const platform = os.platform()
    const ffmpegFileName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const ffprobeFileName = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'

    const bundledDir = path.join(this.getResourcesPath(), 'ffmpeg')
    const ffmpegPath = path.join(bundledDir, ffmpegFileName)
    const ffprobePath = path.join(bundledDir, ffprobeFileName)

    if (!(fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath))) {
      throw new Error(
        `Bundled ffmpeg/ffprobe not found in ${bundledDir}. Ensure they are packaged under resources/ffmpeg/.`
      )
    }

    if (platform !== 'win32') {
      try {
        fs.chmodSync(ffmpegPath, 0o755)
        fs.chmodSync(ffprobePath, 0o755)
      } catch (error) {
        scopedLoggers.engine.warn('Failed to set executable permission on bundled ffmpeg:', error)
      }
    }

    scopedLoggers.engine.info('Using bundled ffmpeg:', ffmpegPath)
    return ffmpegPath
  }
}

export const ffmpegManager = new FfmpegManager()
