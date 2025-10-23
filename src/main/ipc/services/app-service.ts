import os from 'node:os'
import { app, BrowserWindow, dialog } from 'electron'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'

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
}

export { AppService }
