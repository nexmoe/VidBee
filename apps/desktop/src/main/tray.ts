import { type LanguageCode, normalizeLanguageCode } from '@vidbee/i18n/languages'
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import appIcon from '../../resources/icon.png?asset'
import trayIcon from '../../resources/tray-icon.png?asset'
import { settingsManager } from './settings'

let tray: Tray | null = null

/**
 * Get translated text based on current language setting
 */
function t(key: 'showHome' | 'quit'): string {
  const language = normalizeLanguageCode(settingsManager.get('language'))

  const translations: Record<LanguageCode, Record<'showHome' | 'quit', string>> = {
    en: {
      showHome: 'Show Home',
      quit: 'Quit'
    },
    es: {
      showHome: 'Mostrar inicio',
      quit: 'Salir'
    },
    ar: {
      showHome: 'إظهار الصفحة الرئيسية',
      quit: 'إنهاء'
    },
    id: {
      showHome: 'Tampilkan Beranda',
      quit: 'Keluar'
    },
    pt: {
      showHome: 'Mostrar página inicial',
      quit: 'Sair'
    },
    fr: {
      showHome: "Afficher l'accueil",
      quit: 'Quitter'
    },
    it: {
      showHome: 'Mostra Home',
      quit: 'Esci'
    },
    tr: {
      showHome: 'Ana Sayfayı Göster',
      quit: 'Çıkış'
    },
    zh: {
      showHome: '显示主页',
      quit: '退出应用'
    },
    'zh-TW': {
      showHome: '顯示主頁',
      quit: '退出應用程式'
    },
    ko: {
      showHome: '홈 표시',
      quit: '종료'
    },
    ja: {
      showHome: 'ホームを表示',
      quit: '終了'
    },
    ru: {
      showHome: 'Показать главную',
      quit: 'Выход'
    },
    de: {
      showHome: 'Startseite anzeigen',
      quit: 'Beenden'
    }
  }

  return translations[language][key]
}

/**
 * Find the main window
 */
function findMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.find((window) => !window.isDestroyed()) || null
}

/**
 * Create context menu for tray
 */
function createContextMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: t('showHome'),
      click: () => {
        const mainWindow = findMainWindow()
        if (mainWindow) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore()
          }
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('quit'),
      click: () => {
        // Force close all windows before quitting
        const windows = BrowserWindow.getAllWindows()

        // Close all windows forcefully
        for (const window of windows) {
          window.destroy()
        }

        // Quit the application and exit the process
        app.quit()

        // Force exit if quit doesn't work
        setTimeout(() => {
          app.exit(0)
        }, 1000)
      }
    }
  ])
}

/**
 * Create system tray icon
 */
export function createTray(): void {
  if (tray) {
    return
  }

  // Use 16x16 icon for macOS tray, fallback to app icon for other platforms
  const iconPath = process.platform === 'darwin' ? trayIcon : appIcon
  const trayIconImage = nativeImage.createFromPath(iconPath)

  // For macOS, ensure the icon is properly sized
  if (process.platform === 'darwin') {
    // Resize to 16x16 for macOS tray
    trayIconImage.setTemplateImage(true)
  }

  tray = new Tray(trayIconImage)

  // Set tooltip
  tray.setToolTip('VidBee')

  // Set context menu
  tray.setContextMenu(createContextMenu())

  // On Windows/Linux: click to show/hide main window
  tray.on('click', async () => {
    const mainWindow = findMainWindow()
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        // If window is visible, hide it
        mainWindow.hide()
      } else {
        // If window is hidden or minimized, show it
        if (mainWindow.isMinimized()) {
          mainWindow.restore()
        }
        mainWindow.show()
        mainWindow.focus()
      }
    } else {
      // If no main window exists, create a new one
      const { createWindow } = await import('./index')
      createWindow()
    }
  })
}

/**
 * Update tray menu (call this when language changes)
 */
export function updateTrayMenu(): void {
  if (tray) {
    tray.setContextMenu(createContextMenu())
  }
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
