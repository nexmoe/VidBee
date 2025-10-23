import { BrowserWindow } from 'electron'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'

class WindowService extends IpcService {
  static readonly groupName = 'window'

  @IpcMethod()
  minimize(_context: IpcContext): void {
    const window = BrowserWindow.getFocusedWindow()
    if (window) {
      window.minimize()
    }
  }

  @IpcMethod()
  maximize(_context: IpcContext): void {
    const window = BrowserWindow.getFocusedWindow()
    if (window) {
      if (window.isMaximized()) {
        window.unmaximize()
      } else {
        window.maximize()
      }
    }
  }

  @IpcMethod()
  close(_context: IpcContext): void {
    const window = BrowserWindow.getFocusedWindow()
    if (window) {
      window.close()
    }
  }

  @IpcMethod()
  isMaximized(_context: IpcContext): boolean {
    const window = BrowserWindow.getFocusedWindow()
    return window ? window.isMaximized() : false
  }
}

export { WindowService }
