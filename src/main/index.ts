import { join } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, shell } from 'electron'
import log from 'electron-log/main'
import { autoUpdater } from 'electron-updater'
import appIcon from '../../build/icon.png?asset'
import { configureLogger } from './config/logger-config'
import { services } from './ipc'
import { downloadEngine } from './lib/download-engine'
import { ytdlpManager } from './lib/ytdlp-manager'
import { settingsManager } from './settings'
import { createTray, destroyTray } from './tray'

// Initialize electron-log for main process
log.initialize()

// Configure logger settings
configureLogger()

let mainWindow: BrowserWindow | null = null
let isQuitting = false

export function createWindow(): void {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    titleBarStyle: 'hidden', // Hide title bar on macOS
    autoHideMenuBar: true,
    icon: appIcon, // Set application icon
    frame: false,
    vibrancy: 'fullscreen-ui', // on MacOS
    backgroundMaterial: 'acrylic', // on Windows 11
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false // Allow drag regions to work
    }
  })

  mainWindow.on('close', (event) => {
    const closeToTray = settingsManager.get('closeToTray')
    if (closeToTray && !isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Setup download engine event forwarding to renderer
  setupDownloadEvents()
}

function setupDownloadEvents(): void {
  downloadEngine.on('download-started', (id: string) => {
    mainWindow?.webContents.send('download:started', id)
  })

  downloadEngine.on('download-progress', (id: string, progress: unknown) => {
    mainWindow?.webContents.send('download:progress', { id, progress })
  })

  downloadEngine.on('download-completed', (id: string) => {
    mainWindow?.webContents.send('download:completed', id)
  })

  downloadEngine.on('download-error', (id: string, error: Error) => {
    mainWindow?.webContents.send('download:error', { id, error: error.message })
  })

  downloadEngine.on('download-cancelled', (id: string) => {
    mainWindow?.webContents.send('download:cancelled', id)
  })
}

function initAutoUpdater(): void {
  if (process.env.NODE_ENV !== 'production') {
    log.info('Skipping auto-updater initialization in development mode')
    return
  }

  try {
    log.info('Initializing auto-updater...')

    log.transports.file.level = 'info'
    autoUpdater.logger = log
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info) => {
      log.info('Update available:', info.version)
      mainWindow?.webContents.send('update:available', info)
    })

    autoUpdater.on('update-not-available', (info) => {
      log.info('Update not available:', info.version)
      mainWindow?.webContents.send('update:not-available', info)
    })

    autoUpdater.on('error', (err) => {
      log.error('Update error:', err)
      mainWindow?.webContents.send('update:error', err.message)
    })

    autoUpdater.on('download-progress', (progressObj) => {
      log.info('Download progress:', progressObj.percent)
      mainWindow?.webContents.send('update:download-progress', progressObj)
    })

    autoUpdater.on('update-downloaded', (info) => {
      log.info('Update downloaded:', info.version)
      mainWindow?.webContents.send('update:downloaded', info)

      if (mainWindow) {
        mainWindow.webContents.send('update:show-notification', {
          title: 'Update Ready',
          body: `Version ${info.version} has been downloaded and will be installed on restart.`,
          icon: 'app-icon'
        })
      }
    })

    if (settingsManager.get('autoUpdate')) {
      log.info('Auto-update is enabled, checking for updates...')
      void autoUpdater.checkForUpdatesAndNotify()
    }

    log.info('Auto-updater initialized successfully')
  } catch (error) {
    log.error('Failed to initialize auto-updater:', error)
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.vidbee')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC services are automatically registered by electron-ipc-decorator when imported
  log.info('IPC services available:', Object.keys(services))

  // Initialize yt-dlp
  try {
    log.info('Initializing yt-dlp...')
    await ytdlpManager.initialize()
    log.info('yt-dlp initialized successfully')
  } catch (error) {
    log.error('Failed to initialize yt-dlp:', error)
  }

  createWindow()

  initAutoUpdater()

  // Create system tray
  createTray()

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  const closeToTray = settingsManager.get('closeToTray')

  if (process.platform !== 'darwin') {
    if (closeToTray) {
      // Hide to tray instead of quitting
      const mainWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
      if (mainWindow) {
        mainWindow.hide()
      }
    } else {
      app.quit()
    }
  }
})

// Cleanup tray on quit
app.on('will-quit', () => {
  destroyTray()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
