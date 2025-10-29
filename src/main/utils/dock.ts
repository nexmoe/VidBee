import { app } from 'electron'

/**
 * Apply Dock visibility preference on macOS.
 */
export function applyDockVisibility(hideDockIcon: boolean): void {
  if (process.platform !== 'darwin' || !app.dock) {
    return
  }

  if (hideDockIcon) {
    app.dock.hide()
  } else {
    app.dock.show()
  }
}
