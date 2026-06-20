import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type YTDlpWrap from 'yt-dlp-wrap-plus'
import { scopedLoggers } from '../utils/logger'
import { resolveBundledResourcesPath } from './bundled-resources-path'

// Use require for yt-dlp-wrap-plus to handle CommonJS/ESM compatibility
const YTDlpWrapModule = require('yt-dlp-wrap-plus')
const YTDlpWrapCtor: typeof YTDlpWrap = YTDlpWrapModule.default || YTDlpWrapModule
type YTDlpWrapInstance = InstanceType<typeof YTDlpWrapCtor>

/**
 * Manage the packaged yt-dlp binary used by the desktop download engine.
 */
class YtDlpManager {
  private ytdlpPath: string | null = null
  private ytdlpInstance: YTDlpWrapInstance | null = null
  private jsRuntimeArgs: string[] = []

  /**
   * Resolve and cache the packaged yt-dlp executable.
   */
  async initialize(): Promise<void> {
    this.load()
  }

  /**
   * Resolve and cache the yt-dlp binary, wrapper instance, and runtime args.
   *
   * Idempotent and synchronous; throws the underlying resolution error (e.g.
   * "Bundled yt-dlp not found at ...") so callers surface an actionable reason.
   */
  private load(): void {
    this.ytdlpPath = this.resolveBundledYtDlp()
    this.ytdlpInstance = new YTDlpWrapCtor(this.ytdlpPath)
    this.jsRuntimeArgs = this.resolveJsRuntimeArgs()
    scopedLoggers.engine.info('yt-dlp initialized at:', this.ytdlpPath)
  }

  /**
   * Return the yt-dlp wrapper instance, lazily initializing if startup init failed.
   */
  getInstance(): YTDlpWrapInstance {
    if (!this.ytdlpInstance) {
      this.load()
    }
    if (!this.ytdlpInstance) {
      throw new Error('yt-dlp not initialized. Call initialize() first.')
    }
    return this.ytdlpInstance
  }

  /**
   * Return the resolved yt-dlp binary path, lazily initializing if needed.
   */
  getPath(): string {
    if (!this.ytdlpPath) {
      this.load()
    }
    if (!this.ytdlpPath) {
      throw new Error('yt-dlp not initialized. Call initialize() first.')
    }
    return this.ytdlpPath
  }

  /**
   * Report whether yt-dlp is usable, attempting a lazy initialization if needed.
   */
  isReady(): boolean {
    try {
      this.getInstance()
      return true
    } catch {
      return false
    }
  }

  /**
   * Return extra JS runtime arguments for yt-dlp.
   */
  getJsRuntimeArgs(): string[] {
    return [...this.jsRuntimeArgs]
  }

  /**
   * Resolve the platform-specific bundled yt-dlp binary file name.
   */
  private getBundledYtDlpName(): string {
    const platform = os.platform()
    if (platform === 'win32') {
      return 'yt-dlp.exe'
    }
    if (platform === 'darwin') {
      return 'yt-dlp_macos'
    }
    return 'yt-dlp_linux'
  }

  /**
   * Resolve the resources directory that ships the current platform's binaries.
   *
   * Probe for the active platform's yt-dlp binary only; the bundle ships one
   * platform binary, so requiring all three would never match.
   */
  private getResourcesPath(): string {
    return resolveBundledResourcesPath([this.getBundledYtDlpName()])
  }

  /**
   * Locate the packaged yt-dlp executable for the active platform.
   */
  private resolveBundledYtDlp(): string {
    const bundledName = this.getBundledYtDlpName()

    // Desktop only supports the bundled yt-dlp binary shipped in resources.
    const resourcesPath = this.getResourcesPath()
    const bundledPath = path.join(resourcesPath, bundledName)
    if (fs.existsSync(bundledPath)) {
      // Sentry issue VIDBEE-1OM showed packaged Windows builds could resolve
      // to `resources/resources/yt-dlp.exe` even though extraResources were
      // copied directly into `process.resourcesPath`.
      scopedLoggers.engine.info('Using bundled yt-dlp:', bundledPath)
      // Make executable on Unix-like systems if needed
      if (os.platform() !== 'win32') {
        try {
          fs.chmodSync(bundledPath, 0o755)
        } catch (error) {
          scopedLoggers.engine.warn('Failed to set executable permission:', error)
        }
      }
      return bundledPath
    }

    const message = `Bundled yt-dlp not found at ${bundledPath}. Ensure it is packaged in resources.`
    scopedLoggers.engine.error(message)
    throw new Error(message)
  }

  /**
   * Resolve optional JS runtime flags used by yt-dlp.
   */
  private resolveJsRuntimeArgs(): string[] {
    const runtime = (process.env.YTDLP_JS_RUNTIME || 'deno').trim()
    if (!runtime || runtime === 'none') {
      return []
    }

    const runtimePath = this.resolveJsRuntimePath(runtime)
    if (runtimePath) {
      return ['--js-runtimes', `${runtime}:${runtimePath}`]
    }

    if (process.env.YTDLP_JS_RUNTIME) {
      scopedLoggers.engine.warn(
        `Requested JS runtime "${runtime}" was not found. Falling back to yt-dlp default detection.`
      )
    } else {
      scopedLoggers.engine.warn(
        'JS runtime not found. YouTube support may be limited without an external JS runtime.'
      )
    }

    return process.env.YTDLP_JS_RUNTIME ? ['--js-runtimes', runtime] : []
  }

  /**
   * Resolve a JS runtime binary from environment, bundled assets, or PATH.
   */
  private resolveJsRuntimePath(runtime: string): string | null {
    const envPath = process.env.YTDLP_JS_RUNTIME_PATH?.trim()
    if (envPath && fs.existsSync(envPath)) {
      scopedLoggers.engine.info('Using JS runtime from YTDLP_JS_RUNTIME_PATH:', envPath)
      return envPath
    }

    const platform = os.platform()
    const resourcesPath = this.getResourcesPath()
    const resourceCandidates: string[] = []

    if (runtime === 'deno') {
      resourceCandidates.push(platform === 'win32' ? 'deno.exe' : 'deno')
    } else if (runtime === 'node') {
      resourceCandidates.push(platform === 'win32' ? 'node.exe' : 'node')
    } else if (runtime === 'bun') {
      resourceCandidates.push(platform === 'win32' ? 'bun.exe' : 'bun')
    } else if (runtime === 'quickjs') {
      resourceCandidates.push(platform === 'win32' ? 'qjs.exe' : 'qjs')
    } else {
      resourceCandidates.push(runtime)
      if (platform === 'win32' && !runtime.endsWith('.exe')) {
        resourceCandidates.push(`${runtime}.exe`)
      }
    }

    for (const candidate of resourceCandidates) {
      const fullPath = path.join(resourcesPath, candidate)
      if (fs.existsSync(fullPath)) {
        if (platform !== 'win32') {
          try {
            fs.chmodSync(fullPath, 0o755)
          } catch (error) {
            scopedLoggers.engine.warn('Failed to set executable permission on JS runtime:', error)
          }
        }
        scopedLoggers.engine.info('Using bundled JS runtime:', fullPath)
        return fullPath
      }
    }

    try {
      if (platform === 'win32') {
        const output = execSync(`where ${runtime}`).toString().split(/\r?\n/)[0]
        if (output && fs.existsSync(output)) {
          scopedLoggers.engine.info('Using system JS runtime:', output)
          return output
        }
      } else {
        const systemPath = execSync(`which ${runtime}`).toString().trim()
        if (systemPath && fs.existsSync(systemPath)) {
          scopedLoggers.engine.info('Using system JS runtime:', systemPath)
          return systemPath
        }
      }
    } catch (_error) {
      // Runtime not found in PATH
    }

    return null
  }

  // Removed runtime download/update to avoid network dependency in production builds
}

export const ytdlpManager = new YtDlpManager()
