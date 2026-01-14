import os from 'node:os'
import { app, BrowserWindow, dialog } from 'electron'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import { scopedLoggers } from '../../utils/logger'

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
        Number.isFinite(buildNumber) && buildNumber >= 22000 ? 'Windows 11' : 'Windows 10'
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
  async getSiteIcon(_context: IpcContext, domain: string): Promise<string | null> {
    try {
      const iconUrl = `https://unavatar.io/${domain}`
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
      scopedLoggers.system.error('Failed to fetch site icon:', error)
      return null
    }
  }
}

export { AppService }
