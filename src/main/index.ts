import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_PROTOCOL, APP_PROTOCOL_SCHEME } from '@shared/constants'
import { app, BrowserWindow, type BrowserWindowConstructorOptions, protocol, shell } from 'electron'
import log from 'electron-log/main'
import { autoUpdater } from 'electron-updater'
import appIcon from '../../build/icon.png?asset'
import { configureLogger } from './config/logger-config'
import { services } from './ipc'
import { downloadEngine } from './lib/download-engine'
import { ffmpegManager } from './lib/ffmpeg-manager'
import { subscriptionManager } from './lib/subscription-manager'
import { subscriptionScheduler } from './lib/subscription-scheduler'
import { ytdlpManager } from './lib/ytdlp-manager'
import { settingsManager } from './settings'
import { createTray, destroyTray } from './tray'
import { applyAutoLaunchSetting } from './utils/auto-launch'
import { applyDockVisibility } from './utils/dock'

// Initialize electron-log for main process
log.initialize()

// Configure logger settings
configureLogger()

const RENDERER_DIST_PATH = join(__dirname, '../renderer')

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_PROTOCOL,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true
    }
  }
])

let mainWindow: BrowserWindow | null = null
let isQuitting = false

subscriptionManager.on('subscriptions:updated', (subscriptions) => {
  mainWindow?.webContents.send('subscriptions:updated', subscriptions)
})

export function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const isWindows = process.platform === 'win32'

  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    icon: appIcon, // Set application icon
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false // Allow drag regions to work
    }
  }

  if (isMac) {
    windowOptions.titleBarStyle = 'hidden'
    windowOptions.trafficLightPosition = { x: 12.5, y: 10 }
    windowOptions.vibrancy = 'fullscreen-ui'
  }

  if (isWindows) {
    windowOptions.backgroundMaterial = 'acrylic'
  }

  // Create the browser window
  mainWindow = new BrowserWindow(windowOptions)

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
    mainWindow.loadURL(`${APP_PROTOCOL_SCHEME}renderer/index.html`)
  }

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('subscriptions:updated', subscriptionManager.getAll())
  })

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

function sanitizeRequestPath(requestUrl: URL): string {
  const rawPath = `${requestUrl.hostname}${decodeURIComponent(requestUrl.pathname)}`
  const trimmedLeading = rawPath.replace(/^\/+/, '')
  const cleaned = trimmedLeading.replace(/\/+$/, '')
  return cleaned || 'index.html'
}

function isWithinBase(targetPath: string, basePath: string): boolean {
  const relativePath = relative(basePath, targetPath)
  return !relativePath.startsWith('..') && !isAbsolute(relativePath)
}

function resolveVidbeeFilePath(requestUrl: URL, userDataPath: string): string | null {
  const sanitizedPath = sanitizeRequestPath(requestUrl)
  const [rootSegment, ...restSegments] = sanitizedPath.split('/')
  const rendererPath = restSegments.join('/') || 'index.html'

  if (rootSegment === 'renderer') {
    const rendererTarget = resolve(RENDERER_DIST_PATH, rendererPath)

    if (isWithinBase(rendererTarget, RENDERER_DIST_PATH) && existsSync(rendererTarget)) {
      return rendererTarget
    }
  }

  const userDataTarget = resolve(userDataPath, sanitizedPath)

  if (isWithinBase(userDataTarget, userDataPath) && existsSync(userDataTarget)) {
    return userDataTarget
  }

  const rendererFallback = resolve(RENDERER_DIST_PATH, sanitizedPath)

  if (isWithinBase(rendererFallback, RENDERER_DIST_PATH) && existsSync(rendererFallback)) {
    return rendererFallback
  }

  return null
}

function registerVidbeeProtocol(): void {
  try {
    const userDataPath = app.getPath('userData')
    protocol.registerFileProtocol(APP_PROTOCOL, (request, callback) => {
      const requestUrl = new URL(request.url)
      const filePath = resolveVidbeeFilePath(requestUrl, userDataPath)

      if (!filePath) {
        log.error(`File not found for ${request.url}`)
        callback({ error: -6 })
        return
      }

      callback(filePath)
    })
  } catch (error) {
    log.error(`Failed to register ${APP_PROTOCOL} protocol:`, error)
  }
}

function initAutoUpdater(): void {
  try {
    log.info('Initializing auto-updater...')

    log.transports.file.level = 'info'
    autoUpdater.logger = log
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info) => {
      log.info('Update available:', info.version)
      mainWindow?.webContents.send('update:available', info)

      // If auto-update is enabled, the update will be downloaded automatically
      // because autoDownload is set to true
      if (settingsManager.get('autoUpdate')) {
        log.info('Auto-update is enabled, update will be downloaded automatically')
      }
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

    log.info('Auto-updater initialized successfully')

    // Check for updates immediately if auto-update is enabled
    const autoUpdateEnabled = settingsManager.get('autoUpdate')
    if (autoUpdateEnabled) {
      log.info('Auto-update is enabled, checking for updates immediately...')
      // Use checkForUpdates instead of checkForUpdatesAndNotify
      // because we have our own notification system and want to ensure immediate download
      void autoUpdater.checkForUpdates()
    } else {
      log.info('Auto-update is disabled, skipping automatic update check')
    }
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

  registerVidbeeProtocol()

  const registered = app.setAsDefaultProtocolClient(APP_PROTOCOL)
  if (!registered) {
    log.warn(`Failed to register ${APP_PROTOCOL} protocol handler`)
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC services are automatically registered by electron-ipc-decorator when imported
  log.info('IPC services available:', Object.keys(services))

  // Initialize ffmpeg
  try {
    log.info('Initializing ffmpeg...')
    await ffmpegManager.initialize()
    log.info('ffmpeg initialized successfully')
  } catch (error) {
    log.error('Failed to initialize ffmpeg:', error)
  }

  // Initialize yt-dlp
  try {
    log.info('Initializing yt-dlp...')
    await ytdlpManager.initialize()
    log.info('yt-dlp initialized successfully')
  } catch (error) {
    log.error('Failed to initialize yt-dlp:', error)
  }

  applyDockVisibility(settingsManager.get('hideDockIcon'))
  applyAutoLaunchSetting(settingsManager.get('launchAtLogin'))

  createWindow()

  initAutoUpdater()

  // Create system tray
  createTray()

  subscriptionScheduler.start()

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
