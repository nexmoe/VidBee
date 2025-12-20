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
