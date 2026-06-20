import os from 'node:os'
import { app, BrowserWindow, dialog } from 'electron'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import { ffmpegManager } from '../../lib/ffmpeg-manager'
import { ytdlpManager } from '../../lib/ytdlp-manager'
import { scopedLoggers } from '../../utils/logger'
import { buildSiteIconUrl } from './site-icon-url'

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
    try {
      const iconUrl = buildSiteIconUrl(domain)
      const response = await fetch(iconUrl)
      if (!response.ok) {
        return null
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const contentType = response.headers.get('content-type') || 'image/png'
      const base64 = buffer.toString('base64')
      return `data:${contentType};base64,${base64}`
    } catch (error) {
      scopedLoggers.system.error(`Failed to fetch site icon for ${domain}: ${String(error)}`)
      return null
    }
  }
}

export { AppService }
