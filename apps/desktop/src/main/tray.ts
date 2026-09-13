import { join } from 'node:path'
import { app, BrowserWindow, nativeImage, Tray } from 'electron'
import windowsTrayIcon from '../../build/icon.ico?asset'
import appIcon from '../../resources/icon.png?asset'
import trayIcon from '../../resources/tray-icon.png?asset'
import { bindTrayMenuApplier, refreshAppIconMenus } from './lib/app-icon-menu'
import { isShareCaptureWindow } from './lib/share-capture-window'

let tray: Tray | null = null

/**
 * Find the main window
 */
function findMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.find((window) => !(window.isDestroyed() || isShareCaptureWindow(window))) || null
}

/**
 * Resolve a visible tray icon for the current platform and build mode.
 */
function resolveTrayIconPath(): string {
  if (process.platform === 'win32') {
    return windowsTrayIcon
  }
  if (app.isPackaged) {
    const fileName = process.platform === 'darwin' ? 'tray-icon.png' : 'icon.png'
    return join(process.resourcesPath, 'resources', fileName)
  }
  if (process.platform === 'darwin') {
    return trayIcon
  }
  return appIcon
}

/**
 * Create system tray icon
 */
export function createTray(): void {
  if (tray) {
    refreshAppIconMenus()
    return
  }

  const trayIconImage = nativeImage.createFromPath(resolveTrayIconPath())

  // Let macOS tint the menu bar icon for light and dark appearances.
  if (process.platform === 'darwin') {
    trayIconImage.setTemplateImage(true)
  }

  tray = new Tray(trayIconImage)

  tray.setToolTip('VidBee')
  bindTrayMenuApplier((menu) => {
    tray?.setContextMenu(menu)
  })
  refreshAppIconMenus()

  // On Windows/Linux: click to show/hide main window
  tray.on('click', async () => {
    const mainWindow = findMainWindow()
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        if (mainWindow.isMinimized()) {
          mainWindow.restore()
        }
        mainWindow.show()
        mainWindow.focus()
      }
    } else {
      const { createWindow } = await import('./index')
      createWindow()
    }
  })
}

/**
 * Destroy tray icon
 */
export function destroyTray(): void {
  bindTrayMenuApplier(null)
  if (tray) {
    tray.destroy()
    tray = null
  }
}
