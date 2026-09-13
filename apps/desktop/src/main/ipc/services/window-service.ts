import type { ShareCardPayload } from '@shared/types/share-card'
import { BrowserWindow } from 'electron'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import { captureShareCardPng, writeShareImagePng } from '../../lib/share-capture-window'

class WindowService extends IpcService {
  static readonly groupName = 'window'

  /**
   * Render the share card in a hidden window and return a PNG.
   *
   * @param _context Unused sender context; capture uses the reused hidden window.
   * @param payload Serializable card props from the visible preview.
   */
  @IpcMethod()
  async captureShareCard(_context: IpcContext, payload: ShareCardPayload): Promise<ArrayBuffer> {
    const png = await captureShareCardPng(payload)
    return Uint8Array.from(png).buffer
  }

  /**
   * Write a PNG to the system clipboard via `clipboard.writeImage`.
   *
   * @param _context Unused sender context.
   * @param data PNG bytes from `captureShareCard`.
   */
  @IpcMethod()
  writeShareImage(_context: IpcContext, data: ArrayBuffer): void {
    writeShareImagePng(data)
  }

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
