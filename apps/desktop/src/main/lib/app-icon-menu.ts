import {
  APP_ICON_MENU_COMMAND_CHANNEL,
  type AppIconMenuCommand,
  type AppIconMenuState,
  EMPTY_APP_ICON_MENU_STATE,
  sameAppIconMenuState
} from '@shared/app-icon-menu'
import { type TranslationDictionary, translationResources } from '@vidbee/i18n'
import { normalizeLanguageCode } from '@vidbee/i18n/languages'
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { settingsManager } from '../settings'
import { applyDockMenu } from '../utils/dock'
import { isShareCaptureWindow } from './share-capture-window'

interface AppIconMenuCopy {
  next: string
  openDevTools: string
  pause: string
  play: string
  previous: string
  quit: string
  showHome: string
}

const FALLBACK_COPY: AppIconMenuCopy = {
  next: 'Next',
  openDevTools: 'Open DevTools',
  pause: 'Pause',
  play: 'Play',
  previous: 'Previous',
  quit: 'Quit',
  showHome: 'Show Home'
}

let menuState: AppIconMenuState = EMPTY_APP_ICON_MENU_STATE
let applyTrayMenu: ((menu: Menu) => void) | null = null

/**
 * Read localized dock/tray labels, falling back to English.
 */
const loadAppIconMenuCopy = (): AppIconMenuCopy => {
  const language = normalizeLanguageCode(settingsManager.get('language'))
  const bundle = translationResources[language] ?? translationResources.en
  const translation = (bundle as { translation?: TranslationDictionary } | undefined)?.translation
  const tray = translation?.settings.tray
  return {
    next: tray?.next ?? FALLBACK_COPY.next,
    openDevTools: tray?.openDevTools ?? FALLBACK_COPY.openDevTools,
    pause: tray?.pause ?? FALLBACK_COPY.pause,
    play: tray?.play ?? FALLBACK_COPY.play,
    previous: tray?.previous ?? FALLBACK_COPY.previous,
    quit: tray?.quit ?? FALLBACK_COPY.quit,
    showHome: tray?.showHome ?? FALLBACK_COPY.showHome
  }
}

/**
 * Find the main window so dock/tray actions can reach the renderer.
 */
const findMainWindow = (): BrowserWindow | null => {
  return (
    BrowserWindow.getAllWindows().find(
      (window) => !(window.isDestroyed() || isShareCaptureWindow(window))
    ) ?? null
  )
}

/**
 * Restore, show, and focus a window.
 */
const showAndFocusWindow = (window: BrowserWindow): void => {
  if (window.isMinimized()) {
    window.restore()
  }
  window.show()
  window.focus()
}

/**
 * Return the existing main window or create one when needed.
 */
const ensureMainWindow = async (): Promise<BrowserWindow | null> => {
  let mainWindow = findMainWindow()
  if (!mainWindow) {
    const { createWindow } = await import('../index')
    createWindow()
    mainWindow = findMainWindow()
  }
  return mainWindow
}

/**
 * Ask the renderer to run a playback command from the dock or tray menu.
 */
const sendIconMenuCommand = (command: AppIconMenuCommand): void => {
  const mainWindow = findMainWindow()
  if (!mainWindow) {
    return
  }
  mainWindow.webContents.send(APP_ICON_MENU_COMMAND_CHANNEL, command)
}

/**
 * Build the shared Play / Next / Previous items for dock and tray.
 */
const buildPlaybackMenuTemplate = (
  copy: AppIconMenuCopy,
  state: AppIconMenuState
): MenuItemConstructorOptions[] => [
  {
    click: () => {
      sendIconMenuCommand('toggle')
    },
    enabled: state.canToggle,
    label: state.playing ? copy.pause : copy.play
  },
  {
    click: () => {
      sendIconMenuCommand('next')
    },
    enabled: state.canNext,
    label: copy.next
  },
  {
    click: () => {
      sendIconMenuCommand('previous')
    },
    enabled: state.canPrevious,
    label: copy.previous
  }
]

/**
 * Bind the live tray so menu refreshes can replace its context menu.
 */
export function bindTrayMenuApplier(applier: ((menu: Menu) => void) | null): void {
  applyTrayMenu = applier
}

/**
 * Rebuild dock and tray menus from the latest playback state and language.
 */
export function refreshAppIconMenus(): void {
  const copy = loadAppIconMenuCopy()
  const playbackItems = buildPlaybackMenuTemplate(copy, menuState)
  applyDockMenu(Menu.buildFromTemplate(playbackItems))
  applyTrayMenu?.(
    Menu.buildFromTemplate([
      ...playbackItems,
      { type: 'separator' },
      {
        click: () => {
          const mainWindow = findMainWindow()
          if (mainWindow) {
            showAndFocusWindow(mainWindow)
          }
        },
        label: copy.showHome
      },
      {
        click: async () => {
          const mainWindow = await ensureMainWindow()
          if (!mainWindow) {
            return
          }
          showAndFocusWindow(mainWindow)
          mainWindow.webContents.openDevTools()
        },
        label: copy.openDevTools
      },
      { type: 'separator' },
      {
        click: () => {
          app.quit()
        },
        label: copy.quit
      }
    ])
  )
}

/**
 * Replace the cached playback state and refresh menus when it actually changed.
 */
export function setAppIconMenuState(nextState: AppIconMenuState): void {
  if (sameAppIconMenuState(menuState, nextState)) {
    return
  }
  menuState = nextState
  refreshAppIconMenus()
}

if (app.isReady()) {
  refreshAppIconMenus()
}
