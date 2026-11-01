import { app, type BrowserWindow } from 'electron'
import log from 'electron-log/main'
import type ElectronStore from 'electron-store'

const ElectronStoreModule = require('electron-store')
const Store: typeof ElectronStore = ElectronStoreModule.default || ElectronStoreModule

interface WindowState {
  width: number
  height: number
  maximized: boolean
}

const DEFAULT_WINDOW_STATE: WindowState = { width: 1200, height: 800, maximized: false }
let store: ElectronStore<WindowState> | undefined

/** Return the window-state store in the active desktop profile. */
const getWindowStateStore = (): ElectronStore<WindowState> => {
  store ??= new Store<WindowState>({
    cwd: app.getPath('userData'),
    name: 'window-state',
    defaults: DEFAULT_WINDOW_STATE
  })
  return store
}

/** Load normal dimensions and maximized state, including legacy size-only profiles. */
export const getMainWindowState = (): WindowState => {
  try {
    const { width, height, maximized } = getWindowStateStore().store
    if (Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0) {
      return { width, height, maximized: maximized === true }
    }
  } catch (error) {
    log.warn('Failed to load main window state:', error)
  }
  return { ...DEFAULT_WINDOW_STATE }
}

/** Restore on first show and cache window state for closing or direct destruction. */
export const rememberMainWindowState = (
  window: BrowserWindow,
  initiallyMaximized: boolean
): void => {
  let { width, height } = window.getNormalBounds()
  let maximized = initiallyMaximized
  let pendingMaximize = initiallyMaximized

  /** Keep normal dimensions and preserve zoom while minimized, fullscreen or awaiting first show. */
  const updateState = (): void => {
    const bounds = window.getNormalBounds()
    width = bounds.width
    height = bounds.height
    if (!(pendingMaximize || window.isMinimized() || window.isFullScreen())) {
      maximized = window.isMaximized()
    }
  }

  // Electron's maximize() shows hidden windows, so wait for an intentional first show.
  window.once('show', () => {
    if (pendingMaximize) {
      pendingMaximize = false
      window.maximize()
    }
  })
  window.on('resize', updateState)
  window.on('maximize', updateState)
  window.on('unmaximize', updateState)
  window.on('close', updateState)
  window.once('closed', () => {
    try {
      getWindowStateStore().set({ width, height, maximized })
    } catch (error) {
      log.warn('Failed to save main window state:', error)
    }
  })
}
