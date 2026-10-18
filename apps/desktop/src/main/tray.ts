import { join } from 'node:path'
import { app, BrowserWindow, nativeImage, Tray } from 'electron'
import windowsTrayIcon from '../../build/icon.ico?asset'
import appIcon from '../../resources/icon.png?asset'
import trayIcon from '../../resources/tray-icon.png?asset'
import { getTrayContextMenu, refreshAppIconMenus, showAndFocusWindow } from './lib/app-icon-menu'
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
  refreshAppIconMenus()
  // Ignore the synthesized double-click so every single click shows the window.
  if (process.platform === 'darwin') {
    tray.setIgnoreDoubleClickEvents(true)
  }

  // Left click shows the window. The menu stays on right click so a single click is not swallowed.
  tray.on('click', async () => {
    const mainWindow = findMainWindow()
    if (!mainWindow) {
      const { createWindow } = await import('./index')
      createWindow()
      return
    }
    showAndFocusWindow(mainWindow)
  })
  tray.on('right-click', () => {
    const menu = getTrayContextMenu()
    if (menu) {
      tray?.popUpContextMenu(menu)
    }
  })
}

/**
 * Destroy tray icon
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
