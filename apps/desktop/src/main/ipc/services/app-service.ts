import os from 'node:os'
import type { YtDlpKernelStatus } from '@shared/types'
import { app, BrowserWindow, dialog } from 'electron'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import { ffmpegManager } from '../../lib/ffmpeg-manager'
import { getYtDlpKernelService } from '../../lib/ytdlp-kernel-host'
import { ytdlpManager } from '../../lib/ytdlp-manager'
import { scopedLoggers } from '../../utils/logger'
import { buildSiteIconFallbackUrl, buildSiteIconUrl } from './site-icon-url'

class AppService extends IpcService {
  static readonly groupName = 'app'

  @IpcMethod()
  getVersion(_context: IpcContext): string {
    return app.getVersion()
  }

  @IpcMethod()
  getPlatform(_context: IpcContext): string {
    return os.platform()
  }

  @IpcMethod()
  async getDownloaderStatus(
    _context: IpcContext
  ): Promise<{ ytdlpReady: boolean; ffmpegReady: boolean }> {
    const ffmpegReady = await ffmpegManager.isReady()
    return { ytdlpReady: ytdlpManager.isReady(), ffmpegReady }
  }

  /**
   * Return the current yt-dlp and Deno kernel status.
   */
  @IpcMethod()
  getYtDlpKernelStatus(_context: IpcContext): YtDlpKernelStatus {
    return getYtDlpKernelService().getStatus()
  }

  /**
   * Retry local kernel preparation after a fatal startup failure.
   */
  @IpcMethod()
  async retryYtDlpKernelPreparation(_context: IpcContext): Promise<YtDlpKernelStatus> {
    const service = getYtDlpKernelService()
    await service.prepare()
    return service.getStatus()
  }

  @IpcMethod()
  getOsVersion(_context: IpcContext): string {
    const platform = os.platform()
    const platformLabel =
      platform === 'darwin'
        ? 'macOS'
        : platform === 'win32'
          ? 'Windows'
          : platform === 'linux'
            ? 'Linux'
            : platform
    const systemVersion =
      typeof (process as { getSystemVersion?: () => string }).getSystemVersion === 'function'
        ? (process as { getSystemVersion: () => string }).getSystemVersion()
        : typeof os.version === 'function'
          ? os.version()
          : os.release()

    if (platform === 'win32') {
      const buildToken = systemVersion.split('.').at(-1) ?? ''
      const buildNumber = Number.parseInt(buildToken, 10)
      const windowsName =
        Number.isFinite(buildNumber) && buildNumber >= 22_000 ? 'Windows 11' : 'Windows 10'
      return Number.isFinite(buildNumber)
        ? `${windowsName} (build ${buildNumber})`
        : `${platformLabel} ${systemVersion}`.trim()
    }

    return `${platformLabel} ${systemVersion}`.trim()
  }

  @IpcMethod()
  quit(_context: IpcContext): void {
    app.quit()
  }

  @IpcMethod()
  async showMessageBox(
    _context: IpcContext,
    options: Electron.MessageBoxOptions
  ): Promise<Electron.MessageBoxReturnValue> {
    const window = BrowserWindow.getFocusedWindow()
    if (window) {
      return dialog.showMessageBox(window, options)
    }

    return dialog.showMessageBox(options)
  }

  @IpcMethod()
  /**
   * Fetches a site icon and returns it as a data URL.
   */
  async getSiteIcon(_context: IpcContext, domain: string): Promise<string | null> {
    const iconUrls = [buildSiteIconUrl(domain), buildSiteIconFallbackUrl(domain)]
    for (const iconUrl of iconUrls) {
      try {
        const response = await fetch(iconUrl)
        if (!response.ok) {
          continue
        }

        const contentType = response.headers.get('content-type') || 'image/png'
        if (!(contentType.includes('image/') || contentType.includes('icon'))) {
          continue
        }

        const arrayBuffer = await response.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        const base64 = buffer.toString('base64')
        return `data:${contentType};base64,${base64}`
      } catch (error) {
        scopedLoggers.system.error(`Failed to fetch site icon for ${domain}: ${String(error)}`)
      }
    }

    return null
  }
}

export { AppService }
