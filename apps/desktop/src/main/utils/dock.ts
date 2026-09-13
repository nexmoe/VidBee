import { app, BrowserWindow, type Menu } from 'electron'

let dockMenu: Menu | null = null

/**
 * Sync Dock visibility: hide only when the setting is enabled and no window is visible.
 */
export function applyDockVisibility(hideDockIcon: boolean): void {
  if (process.platform !== 'darwin' || !app.dock) {
    return
  }

  if (!hideDockIcon) {
    app.dock.show()
    return
  }

  const hasVisibleWindow = BrowserWindow.getAllWindows().some(
    (w) => !w.isDestroyed() && w.isVisible()
  )

  if (hasVisibleWindow) {
    app.dock.show()
  } else {
    app.dock.hide()
  }
}

/**
 * Replace the macOS Dock icon menu. No-op on other platforms.
 */
export function applyDockMenu(menu: Menu): void {
  if (process.platform !== 'darwin' || !app.dock) {
    return
  }
  dockMenu = menu
  app.dock.setMenu(dockMenu)
}
