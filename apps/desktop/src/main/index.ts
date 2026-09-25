import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_PROTOCOL, APP_PROTOCOL_SCHEME } from '@shared/constants'
import type { YtDlpKernelStatus } from '@shared/types'
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  ipcMain,
  protocol,
  shell
} from 'electron'
import log from 'electron-log/main'
import { autoUpdater } from 'electron-updater'
import appIcon from '../../build/icon.png?asset'
import { classifyDownloadError } from '../shared/telemetry/yt-dlp-error-classifier'
import {
  buildAudioFormatPreference,
  buildVideoFormatPreference
} from '../shared/utils/format-preferences'
import { configureLogger } from './config/logger-config'
import { services } from './ipc'
import { registerAgentArtifactProtocol } from './lib/agent-artifacts'
import { stopAllAgentRuns } from './lib/agent-chat-runner'
import { stopAllPromptRuns } from './lib/ai-prompt-runner'
import {
  AUTH_PROTOCOL,
  handleDesktopAuthCallback,
  isDesktopAuthCallback,
  registerDesktopAuthProtocol,
  setupDesktopAuth
} from './lib/auth-client'
import { downloadEngine } from './lib/download-facade'
import { ffmpegManager } from './lib/ffmpeg-manager'
import {
  addMainBreadcrumb,
  captureMainException,
  captureMainMessage,
  initGlitchTipMain
} from './lib/glitchtip'
import { localMediaKind } from './lib/import-local-media'
import { stopPlayerHost } from './lib/player-host'
import {
  installPrivilegedSchemeCollector,
  TRUSTWORTHY_CUSTOM_ORIGINS
} from './lib/privileged-schemes'
import { deferAppQuitIfNeeded } from './lib/quit-confirmation-host'
import { createRendererConsoleLogGate } from './lib/renderer-console-log'
import { destroyShareCaptureWindow, isAppWindow } from './lib/share-capture-window'
import { initializeOptionalTool } from './lib/startup-dependencies'
import {
  getDesktopSubscriptions,
  listDesktopSubscriptionsSnapshot,
  startDesktopSubscriptions,
  stopDesktopSubscriptions
} from './lib/subscriptions-host'
import { startDesktopTaskQueue } from './lib/task-queue-host'
import { runDesktopTaskQueueMigration } from './lib/task-queue-migrate'
import {
  importLocalMediaForTranscription,
  startAutoTranscription,
  startIdleMinimalModelFill,
  subscribeTranscriptBroadcasts
} from './lib/transcript-host'
import { applyUpdateChannel } from './lib/update-channel'
import { initializeYtDlpKernelService, stopYtDlpKernelService } from './lib/ytdlp-kernel-host'
import { startExtensionApiServer, stopExtensionApiServer } from './local-api'
import { isPortableMode } from './portable'
import { settingsManager } from './settings'
import { createTray, destroyTray } from './tray'
import { applyAutoLaunchSetting } from './utils/auto-launch'
import { applyDockVisibility } from './utils/dock'

// NEX-131 §5.4: tray-only mode. Set when launched via the CLI / autostart so
// the main window stays hidden until the user clicks the tray icon.
const isBackgroundLaunch = (argv: string[]): boolean =>
  argv.some((arg) => arg === '--background' || arg === '--from-cli')

const BACKGROUND_MODE = isBackgroundLaunch(process.argv)
const KERNEL_PREPARATION_PREVIEW =
  !app.isPackaged && process.argv.includes('--kernel-preparation-preview')

// Initialize electron-log for main process
log.initialize()

// Configure logger settings
configureLogger()
initGlitchTipMain()

process.on('uncaughtException', (error) => {
  log.error('Main process uncaught exception:', error)
  captureMainException(error, {
    tags: {
      source: 'process.uncaughtException'
    }
  })
})

process.on('unhandledRejection', (reason) => {
  log.error('Main process unhandled rejection:', reason)
  captureMainException(reason, {
    tags: {
      source: 'process.unhandledRejection'
    }
  })
})

if (process.platform === 'linux') {
  // Force fallback to native GTK/KDE file dialogs when desktop portal is too old.
  // This avoids folder selection issues on older Linux distributions.
  app.commandLine.appendSwitch('xdg-portal-required-version', '4')
}

if (process.platform === 'win32') {
  // Keep GPU compositing enabled while avoiding driver crashes during local video decoding.
  app.commandLine.appendSwitch('disable-accelerated-video-decode')
}

if (!app.isPackaged && process.env.VIDBEE_E2E !== '1') {
  app.commandLine.appendSwitch('remote-debugging-port', '9229')
}

if (!app.isPackaged) {
  app.commandLine.appendSwitch(
    'unsafely-treat-insecure-origin-as-secure',
    TRUSTWORTHY_CUSTOM_ORIGINS.join(',')
  )
}

const RENDERER_DIST_PATH = join(import.meta.dirname, '../renderer')
const CUSTOM_PROTOCOL_PRIVILEGES = {
  corsEnabled: true,
  secure: true,
  standard: true,
  stream: true,
  supportFetchAPI: true
} as const
const flushPrivilegedSchemes = installPrivilegedSchemeCollector()

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'agent-artifact',
    privileges: { ...CUSTOM_PROTOCOL_PRIVILEGES }
  },
  {
    scheme: APP_PROTOCOL,
    privileges: { ...CUSTOM_PROTOCOL_PRIVILEGES }
  },
  {
    scheme: 'user-image',
    privileges: {
      bypassCSP: true,
      secure: true,
      standard: false,
      stream: true
    }
  }
])

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let promptRunsStoppingForQuit = false
let promptRunsStoppedForQuit = false
let isYtdlpReady = false
let kernelBackgroundUpdatesStarted = false
interface DeepLinkData {
  url: string
  type: 'single' | 'playlist'
}
const pendingDeepLinkUrls: DeepLinkData[] = []
const pendingOneClickDownloads: DeepLinkData[] = []
const pendingMediaPaths: string[] = []
let pendingAuthContinue = false
let pendingCreditRefresh = false
let isTaskQueueReady = false
let isRendererReady = false
let isRendererUnresponsive = false
let isMainWindowReadyToShow = false
let shouldKeepMainWindowHiddenAtStartup = false
let rendererRecoveryPromise: Promise<void> | null = null

/**
 * Return the renderer entry URL without preserving a crashed hash route.
 */
const rendererEntryUrl = (): string =>
  (process.env.ELECTRON_RENDERER_URL &&
    (process.env.PORTLESS_URL || process.env.ELECTRON_RENDERER_URL)) ||
  `${APP_PROTOCOL_SCHEME}renderer/index.html`

/**
 * Load a fresh renderer at the home route.
 */
const loadRendererEntry = (window: BrowserWindow): Promise<void> =>
  window.loadURL(rendererEntryUrl())

/**
 * True when a window can no longer receive renderer work.
 */
const isRendererUnavailable = (window: BrowserWindow): boolean =>
  window.isDestroyed() || window.webContents.isDestroyed() || window.webContents.isCrashed()

/**
 * Replace a failed renderer process with a fresh home route in the same native window.
 */
const recoverRendererToHome = (window: BrowserWindow, trigger: string): void => {
  if (isQuitting || window.isDestroyed() || window.webContents.isDestroyed()) {
    return
  }
  if (rendererRecoveryPromise) {
    return
  }

  isRendererReady = false
  isRendererUnresponsive = false
  shouldKeepMainWindowHiddenAtStartup = !window.isVisible()
  log.warn(`Recovering renderer at home after ${trigger}`)
  rendererRecoveryPromise = loadRendererEntry(window)
    .then(() => {
      log.info(`Renderer recovered at home after ${trigger}`)
    })
    .catch((error: unknown) => {
      log.error(`Failed to recover renderer after ${trigger}:`, error)
      captureMainException(error, { tags: { source: 'renderer.recovery', trigger } })
    })
    .finally(() => {
      rendererRecoveryPromise = null
    })
}

/**
 * Return the healthy main window, if one is available.
 */
const getActiveMainWindow = (): BrowserWindow | null => {
  if (!mainWindow || isRendererUnavailable(mainWindow)) {
    return null
  }
  return mainWindow
}

setupDesktopAuth(getActiveMainWindow)
flushPrivilegedSchemes()

const sendToRenderer = (channel: string, ...args: unknown[]): void => {
  const window = getActiveMainWindow()
  if (!window) {
    return
  }
  try {
    window.webContents.send(channel, ...args)
  } catch (error) {
    log.warn('Failed to send message to renderer:', channel, error)
  }
}

const showMainWindowWhenReady = (): void => {
  const window = getActiveMainWindow()
  if (!window) {
    return
  }

  if (shouldKeepMainWindowHiddenAtStartup) {
    applyDockVisibility(settingsManager.get('hideDockIcon'))
    return
  }

  if (isMainWindowReadyToShow && isRendererReady && !window.isVisible()) {
    window.show()
  }
}

/** Restore and focus the main window after an operating-system activation. */
const activateMainWindow = (): void => {
  const window = mainWindow
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return
  }
  if (window.isMinimized()) {
    window.restore()
  }
  window.show()
  if (process.platform === 'darwin') {
    app.focus({ steal: true })
  }
  window.focus()
  if (window.webContents.isCrashed()) {
    recoverRendererToHome(window, 'operating-system activation')
  } else if (isRendererUnresponsive) {
    log.warn('Operating-system activation found an unresponsive renderer; forcing recovery')
    window.webContents.forcefullyCrashRenderer()
  }
}

ipcMain.on('app:renderer-ready', (event) => {
  const window = getActiveMainWindow()
  if (!window || event.sender !== window.webContents) {
    return
  }

  isRendererReady = true
  showMainWindowWhenReady()
  flushPendingDeepLinks()
  flushPendingAuthContinue()
  flushPendingCreditRefresh()
  void flushPendingMediaImports()
})

/** Parse a post-signup open or continue action from a VidBee app URL. */
const parseAppActionDeepLink = (rawUrl: string): 'continue' | 'open' | 'credits' | null => {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== `${APP_PROTOCOL}:`) {
      return null
    }
    const action = (parsed.hostname || parsed.pathname.replace(/^\/+/u, '')).toLowerCase()
    if (action === 'credits') {
      return 'credits'
    }
    if (action === 'signin' || action === 'continue') {
      return 'continue'
    }
    if (!action || action === 'open') {
      return 'open'
    }
    return null
  } catch {
    return null
  }
}

/** Ask the renderer to finish browser sign-in once it can receive IPC. */
const requestAuthContinue = (): void => {
  activateMainWindow()
  if (!(getActiveMainWindow() && isRendererReady)) {
    pendingAuthContinue = true
    return
  }
  sendToRenderer('auth:continue')
}

/** Deliver a queued post-signup sign-in request after the renderer is ready. */
const flushPendingAuthContinue = (): void => {
  if (!(pendingAuthContinue && getActiveMainWindow() && isRendererReady)) {
    return
  }
  pendingAuthContinue = false
  sendToRenderer('auth:continue')
}

/** Deliver a payment return after the renderer can refresh its account data. */
const flushPendingCreditRefresh = (): void => {
  if (!(pendingCreditRefresh && getActiveMainWindow() && isRendererReady)) {
    return
  }
  pendingCreditRefresh = false
  sendToRenderer('account:credits-updated')
}

const parseDownloadDeepLink = (rawUrl: string): DeepLinkData | null => {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== `${APP_PROTOCOL}:`) {
      return null
    }

    const host = parsed.hostname
    const path = parsed.pathname.replace(/^\/+/, '')
    const isDownloadLink = host === 'download' || path.startsWith('download')
    if (!isDownloadLink) {
      return null
    }

    const targetUrl = parsed.searchParams.get('url')
    if (!targetUrl?.trim()) {
      return null
    }

    const typeParam = parsed.searchParams.get('type')
    const type = typeParam === 'playlist' ? 'playlist' : 'single'

    return {
      url: targetUrl.trim(),
      type
    }
  } catch (error) {
    log.warn('Failed to parse deep link:', error)
    return null
  }
}

const deliverDeepLink = (data: DeepLinkData): void => {
  const window = getActiveMainWindow()
  if (!(window && isRendererReady && isYtdlpReady)) {
    pendingDeepLinkUrls.push(data)
    return
  }

  if (window.isMinimized()) {
    window.restore()
  }
  if (!window.isVisible()) {
    window.show()
  }
  window.focus()
  sendToRenderer('download:deeplink', data)
}

const flushPendingDeepLinks = (): void => {
  if (
    !(getActiveMainWindow() && isRendererReady && isYtdlpReady) ||
    pendingDeepLinkUrls.length === 0
  ) {
    return
  }

  const pending = pendingDeepLinkUrls.splice(0, pendingDeepLinkUrls.length)
  for (const data of pending) {
    sendToRenderer('download:deeplink', data)
  }
}

const handleDeepLinkUrl = (rawUrl: string): void => {
  const appAction = parseAppActionDeepLink(rawUrl)
  if (appAction === 'credits') {
    pendingCreditRefresh = true
    activateMainWindow()
    flushPendingCreditRefresh()
    return
  }
  if (appAction === 'continue') {
    requestAuthContinue()
    return
  }
  if (appAction === 'open') {
    activateMainWindow()
    return
  }

  const data = parseDownloadDeepLink(rawUrl)
  if (!data) {
    log.warn('Ignored unsupported deep link:', rawUrl)
    addMainBreadcrumb('deeplink', 'Ignored unsupported deep link', {
      url: rawUrl
    })
    return
  }
  addMainBreadcrumb('deeplink', 'Received deep link', {
    type: data.type,
    url: data.url
  })
  if (settingsManager.get('oneClickDownload')) {
    queueOneClickDownload(data)
    return
  }
  deliverDeepLink(data)
}

const handleDeepLinkArgv = (argv: string[]): void => {
  for (const arg of argv) {
    if (arg.startsWith(`${APP_PROTOCOL}://`)) {
      handleDeepLinkUrl(arg)
    }
  }
}

/**
 * Return whether an argv token looks like a local media file we can import.
 */
const isLaunchMediaArg = (arg: string): boolean => {
  if (!arg || arg.startsWith('-')) {
    return false
  }
  if (arg.startsWith(`${APP_PROTOCOL}://`)) {
    return false
  }
  return localMediaKind(arg) !== null && existsSync(arg)
}

/**
 * Queue local media paths dropped on the app icon or passed as launch args.
 */
const queueMediaImport = (filePath: string): void => {
  if (!isLaunchMediaArg(filePath) && localMediaKind(filePath) === null) {
    return
  }
  pendingMediaPaths.push(filePath)
  void flushPendingMediaImports()
}

/**
 * Import queued local media files once the renderer and task queue are ready.
 */
const flushPendingMediaImports = async (): Promise<void> => {
  if (!(isRendererReady && isTaskQueueReady && pendingMediaPaths.length > 0)) {
    return
  }
  const paths = pendingMediaPaths.splice(0, pendingMediaPaths.length)
  const window = getActiveMainWindow()
  if (window) {
    if (window.isMinimized()) {
      window.restore()
    }
    if (!window.isVisible()) {
      window.show()
    }
    window.focus()
  }
  try {
    await startDesktopTaskQueue()
    const result = await importLocalMediaForTranscription(paths)
    sendToRenderer('media:imported', result)
  } catch (error) {
    log.warn('Failed to import dropped local media:', error)
  }
}

/**
 * Collect media file paths from process arguments.
 */
const handleMediaArgv = (argv: string[]): void => {
  for (const arg of argv) {
    if (isLaunchMediaArg(arg)) {
      queueMediaImport(arg)
    }
  }
}

// NEX-132 Phase B: bridge `SubscriptionsApi.on('changed')` → renderer's
// legacy `subscriptions:updated` IPC event so the existing UI keeps working
// while it migrates to task-queue-derived subscription item state.
getDesktopSubscriptions().on('changed', () => {
  void listDesktopSubscriptionsSnapshot()
    .then((snapshot) => sendToRenderer('subscriptions:updated', snapshot))
    .catch((err) => log.warn('Failed to broadcast subscriptions:updated:', err))
})

/**
 * Create and load the main desktop window.
 */
export function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const isWindows = process.platform === 'win32'
  shouldKeepMainWindowHiddenAtStartup =
    BACKGROUND_MODE || (isWindows && app.getLoginItemSettings().wasOpenedAtLogin)
  isMainWindowReadyToShow = false
  isRendererReady = false

  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    icon: appIcon, // Set application icon
    frame: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
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
    if (isQuitting) {
      return
    }

    if (mainWindow && (isRendererUnavailable(mainWindow) || isRendererUnresponsive)) {
      event.preventDefault()
      log.warn('Quitting instead of hiding a failed renderer window')
      app.quit()
      return
    }

    const closeToTray = settingsManager.get('closeToTray')
    if (closeToTray) {
      event.preventDefault()
      mainWindow?.hide()
      return
    }

    // On Windows/Linux, closing the last window quits the app.
    if (process.platform !== 'darwin' && deferAppQuitIfNeeded()) {
      event.preventDefault()
    }
  })

  const rendererConsoleLog = createRendererConsoleLogGate((line) => {
    log.scope('renderer').warn(line)
  })

  mainWindow.on('closed', () => {
    rendererConsoleLog.flush()
    mainWindow = null
    isRendererReady = false
    destroyShareCaptureWindow()
    applyDockVisibility(settingsManager.get('hideDockIcon'))
  })

  mainWindow.on('show', () => {
    applyDockVisibility(settingsManager.get('hideDockIcon'))
  })

  mainWindow.on('hide', () => {
    applyDockVisibility(settingsManager.get('hideDockIcon'))
  })

  mainWindow.on('ready-to-show', () => {
    isMainWindowReadyToShow = true
    showMainWindowWhenReady()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('console-message', (event) => {
    rendererConsoleLog.handle(event)
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  void loadRendererEntry(mainWindow).catch((error: unknown) => {
    log.error('Failed to load renderer entry:', error)
    captureMainException(error, { tags: { source: 'renderer.load' } })
  })

  mainWindow.webContents.on('did-finish-load', () => {
    isRendererUnresponsive = false
    void listDesktopSubscriptionsSnapshot()
      .then((snapshot) => sendToRenderer('subscriptions:updated', snapshot))
      .catch((err) => log.warn('Failed to send initial subscriptions snapshot:', err))

    setTimeout(() => {
      if (isRendererReady || shouldKeepMainWindowHiddenAtStartup) {
        return
      }

      log.warn('Renderer ready signal was not received; showing window via fallback')
      isRendererReady = true
      showMainWindowWhenReady()
      flushPendingDeepLinks()
      flushPendingAuthContinue()
    }, 5000)
  })

  // Setup error handling for renderer process
  setupRendererErrorHandling(mainWindow)

  // Setup download engine event forwarding to renderer
  setupDownloadEvents()
}

/**
 * Capture renderer failures and recover a native window that can no longer draw.
 */
function setupRendererErrorHandling(window: BrowserWindow): void {
  // Sentry issue VIDBEE-H8: Electron emits `unresponsive` for transient hangs
  // too. Only capture freezes that actually exceed the 5s threshold so the
  // signal isn't drowned out by short main-thread blips, and report the
  // measured duration so we can tell a 6s blip apart from a 60s lockup.
  const RENDERER_UNRESPONSIVE_REPORT_MS = 5000
  const RENDERER_UNRESPONSIVE_RECOVERY_MS = 15_000
  let unresponsiveSince: number | null = null
  let unresponsiveTimer: NodeJS.Timeout | null = null
  let unresponsiveRecoveryTimer: NodeJS.Timeout | null = null
  let unresponsiveReported = false

  /**
   * Cancel pending renderer-hang work after recovery or process exit.
   */
  const clearUnresponsiveTimers = (): void => {
    if (unresponsiveTimer) {
      clearTimeout(unresponsiveTimer)
      unresponsiveTimer = null
    }
    if (unresponsiveRecoveryTimer) {
      clearTimeout(unresponsiveRecoveryTimer)
      unresponsiveRecoveryTimer = null
    }
  }

  window.webContents.on('render-process-gone', (_event, details) => {
    if (isQuitting) {
      return
    }
    const rendererUrl = window.webContents.getURL()
    log.error(
      `Renderer process gone: reason=${details.reason} exitCode=${details.exitCode} url=${rendererUrl}`
    )
    captureMainMessage(
      'Renderer process gone',
      {
        extra: { exit_code: details.exitCode, renderer_url: rendererUrl },
        tags: { reason: details.reason, source: 'renderer.process-gone' }
      },
      'error'
    )
    clearUnresponsiveTimers()
    unresponsiveSince = null
    unresponsiveReported = false
    isRendererUnresponsive = false
    if (details.reason !== 'clean-exit') {
      recoverRendererToHome(window, `renderer ${details.reason}`)
    }
  })

  window.webContents.on('unresponsive', () => {
    log.error('Renderer process became unresponsive')
    addMainBreadcrumb('renderer', 'Renderer process became unresponsive', undefined, 'warning')
    isRendererUnresponsive = true
    unresponsiveSince = Date.now()
    unresponsiveReported = false
    clearUnresponsiveTimers()
    unresponsiveTimer = setTimeout(() => {
      unresponsiveTimer = null
      if (unresponsiveSince === null) {
        return
      }
      unresponsiveReported = true
      captureMainMessage(
        'Renderer process unresponsive (sustained)',
        {
          extra: {
            unresponsive_ms_at_capture: Date.now() - unresponsiveSince,
            threshold_ms: RENDERER_UNRESPONSIVE_REPORT_MS
          },
          tags: {
            source: 'renderer.unresponsive'
          }
        },
        'warning'
      )
    }, RENDERER_UNRESPONSIVE_REPORT_MS)
    if (process.platform === 'win32' && app.isPackaged) {
      unresponsiveRecoveryTimer = setTimeout(() => {
        unresponsiveRecoveryTimer = null
        if (unresponsiveSince === null || isQuitting || isRendererUnavailable(window)) {
          return
        }
        log.error(
          `Renderer remained unresponsive for ${RENDERER_UNRESPONSIVE_RECOVERY_MS}ms; forcing recovery`
        )
        window.webContents.forcefullyCrashRenderer()
      }, RENDERER_UNRESPONSIVE_RECOVERY_MS)
    }
  })

  window.webContents.on('responsive', () => {
    const duration = unresponsiveSince === null ? null : Date.now() - unresponsiveSince
    log.info('Renderer process became responsive again')
    isRendererUnresponsive = false
    addMainBreadcrumb('renderer', 'Renderer process became responsive again', {
      unresponsive_ms: duration ?? undefined,
      reported_to_sentry: unresponsiveReported
    })
    clearUnresponsiveTimers()
    if (unresponsiveReported && duration !== null) {
      captureMainMessage(
        'Renderer process recovered from sustained unresponsiveness',
        {
          extra: { unresponsive_ms: duration },
          tags: { source: 'renderer.unresponsive' }
        },
        'info'
      )
    }
    unresponsiveSince = null
    unresponsiveReported = false
  })

  // Listen for renderer errors via IPC
  ipcMain.on('error:renderer', (_event, errorData) => {
    log.error('Renderer error received:', errorData)

    // Log detailed error information
    if (errorData.error) {
      log.error('Error name:', errorData.error.name)
      log.error('Error message:', errorData.error.message)
      if (errorData.error.stack) {
        log.error('Error stack:', errorData.error.stack)
      }
    }

    if (errorData.errorInfo?.componentStack) {
      log.error('Component stack:', errorData.errorInfo.componentStack)
    }

    if (errorData.context) {
      log.error('Error context:', errorData.context)
    }

    const rendererError =
      errorData?.error && typeof errorData.error === 'object'
        ? new Error(errorData.error.message ?? 'Unknown renderer error')
        : new Error('Unknown renderer error')

    if (errorData?.error?.stack) {
      rendererError.stack = errorData.error.stack
    }

    captureMainException(rendererError, {
      extra: {
        componentStack: errorData?.errorInfo?.componentStack,
        rendererContext: errorData?.context,
        timestamp: errorData?.timestamp
      },
      fingerprint: ['renderer-error', errorData?.error?.name ?? 'Error'],
      tags: {
        error_name: errorData?.error?.name ?? 'Error',
        source: 'renderer.ipc'
      }
    })
  })
}

function setupDownloadEvents(): void {
  downloadEngine.on('download-removed', (id: string) => {
    sendToRenderer('download:removed', id)
  })
  downloadEngine.on('download-queued', (item: unknown) => {
    addMainBreadcrumb('download', 'Download queued')
    sendToRenderer('download:queued', item)
  })

  downloadEngine.on('download-updated', (id: string, updates: unknown) => {
    sendToRenderer('download:updated', { id, updates })
  })

  downloadEngine.on('download-started', (id: string) => {
    addMainBreadcrumb('download', 'Download started', { downloadId: id })
    sendToRenderer('download:started', id)
  })

  downloadEngine.on('download-progress', (id: string, progress: unknown) => {
    sendToRenderer('download:progress', { id, progress })
  })

  downloadEngine.on('download-log', (id: string, logText: string) => {
    sendToRenderer('download:log', { id, log: logText })
  })

  downloadEngine.on('download-completed', (id: string) => {
    addMainBreadcrumb('download', 'Download completed', { downloadId: id })
    sendToRenderer('download:completed', id)
  })

  downloadEngine.on('download-error', (id: string, error: Error) => {
    // Sentry issue VIDBEE-68: classify the error so operational failures (yt-dlp
    // postprocessing, upstream HTTP / DRM / cookies) drop out of telemetry and
    // genuine bugs get a stable category tag.
    const { category, isOperational } = classifyDownloadError(error)
    const glitchTipEventId = isOperational
      ? undefined
      : captureMainException(error, {
          fingerprint: ['download-error', category, error.name, error.message],
          tags: {
            download_id: id,
            download_error_category: category,
            source: 'download-engine'
          }
        })
    if (glitchTipEventId) {
      downloadEngine.updateDownloadInfo(id, { glitchTipEventId })
    }
    sendToRenderer('download:error', { id, error: error.message })
  })

  downloadEngine.on('download-cancelled', (id: string) => {
    sendToRenderer('download:cancelled', id)
  })
}

const createDownloadId = (): string =>
  `download_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

const queueOneClickDownload = (data: DeepLinkData): void => {
  if (!isYtdlpReady) {
    pendingOneClickDownloads.push(data)
    return
  }
  void startOneClickDownload(data)
}

const flushPendingOneClickDownloads = (): void => {
  if (!isYtdlpReady || pendingOneClickDownloads.length === 0) {
    return
  }
  const pending = pendingOneClickDownloads.splice(0, pendingOneClickDownloads.length)
  for (const data of pending) {
    void startOneClickDownload(data)
  }
}

/**
 * Broadcast kernel state and unlock downloads exactly once after local readiness.
 */
const handleYtDlpKernelStatus = (status: YtDlpKernelStatus): void => {
  sendToRenderer('ytdlp-kernel:status', status)
  if (status.ready && !isYtdlpReady) {
    isYtdlpReady = true
    downloadEngine.restoreActiveDownloads()
    flushPendingOneClickDownloads()
    flushPendingDeepLinks()
    flushPendingAuthContinue()
  }
  if (status.ready && app.isPackaged && !kernelBackgroundUpdatesStarted) {
    kernelBackgroundUpdatesStarted = true
    initializeYtDlpKernelService().startBackgroundUpdates()
  }
}

const startOneClickDownload = async (data: DeepLinkData): Promise<void> => {
  try {
    const settings = settingsManager.getAll()
    const downloadType = settings.oneClickDownloadType ?? 'video'
    const format =
      downloadType === 'video'
        ? buildVideoFormatPreference(settings)
        : buildAudioFormatPreference(settings)

    const containerFormat =
      downloadType === 'video' ? (settings.oneClickContainer ?? 'auto') : undefined

    if (data.type === 'playlist') {
      const result = await downloadEngine.startPlaylistDownload({
        url: data.url,
        type: downloadType,
        format,
        containerFormat
      })
      log.info('One-click playlist download queued:', {
        url: data.url,
        count: result.totalCount
      })
      addMainBreadcrumb('download', 'One-click playlist download queued', {
        count: result.totalCount,
        type: data.type,
        url: data.url
      })
      return
    }

    const downloadId = createDownloadId()
    const started = downloadEngine.startDownload(downloadId, {
      url: data.url,
      type: downloadType,
      format,
      containerFormat
    })
    if (started) {
      log.info('One-click download queued:', { id: downloadId, url: data.url })
      addMainBreadcrumb('download', 'One-click download queued', {
        downloadId,
        type: data.type,
        url: data.url
      })
    } else {
      log.info('One-click download already queued:', { id: downloadId, url: data.url })
      addMainBreadcrumb('download', 'One-click download was already queued', {
        downloadId,
        url: data.url
      })
    }
  } catch (error) {
    log.error('Failed to start one-click download:', error)
    captureMainException(error, {
      extra: {
        deepLink: data
      },
      tags: {
        source: 'one-click-download'
      }
    })
  }
}

function sanitizeRequestPath(requestUrl: URL): string {
  const rawPath = `${requestUrl.hostname}${decodeURIComponent(requestUrl.pathname)}`
  const trimmedLeading = rawPath.replace(/^\/+/, '')
  const cleaned = trimmedLeading.replace(/\/+$/, '')
  return cleaned || 'index.html'
}

function isWithinBase(targetPath: string, basePath: string): boolean {
  const relativePath = relative(basePath, targetPath)
  return !(relativePath.startsWith('..') || isAbsolute(relativePath))
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
  registerAgentArtifactProtocol()
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
  if (isPortableMode) {
    log.info('Portable mode is active, skipping auto-updater initialization')
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
      addMainBreadcrumb('update', 'Update available', {
        version: info.version
      })
      sendToRenderer('update:available', info)
      log.info('Automatic updates are required, update will download in the background')
    })

    autoUpdater.on('update-not-available', (info) => {
      log.info('Update not available:', info.version)
      sendToRenderer('update:not-available', info)
    })

    autoUpdater.on('error', (err) => {
      log.error('Update error:', err)
      captureMainException(err, {
        tags: {
          source: 'auto-updater'
        }
      })
      sendToRenderer('update:error', err.message)
    })

    autoUpdater.on('download-progress', (progressObj) => {
      log.info('Download progress:', progressObj.percent)
      sendToRenderer('update:download-progress', progressObj)
    })

    autoUpdater.on('update-downloaded', (info) => {
      log.info('Update downloaded:', info.version)
      addMainBreadcrumb('update', 'Update downloaded', {
        version: info.version
      })
      sendToRenderer('update:downloaded', info)
    })

    log.info('Auto-updater initialized successfully')
    log.info('Automatic updates are required, checking for updates immediately...')
    applyUpdateChannel()
    // Use checkForUpdates instead of checkForUpdatesAndNotify
    // because we have our own notification system and want to ensure immediate download
    void autoUpdater.checkForUpdates()
  } catch (error) {
    log.error('Failed to initialize auto-updater:', error)
    captureMainException(error, {
      tags: {
        source: 'auto-updater.init'
      }
    })
  }
}

const allowMultipleInstances = process.env.VIDBEE_ALLOW_MULTIPLE_INSTANCES === '1'
const gotSingleInstanceLock = allowMultipleInstances || app.requestSingleInstanceLock()

if (gotSingleInstanceLock) {
  app.on('second-instance', (_event, argv) => {
    const authCallback = argv.find(isDesktopAuthCallback)
    if (authCallback) {
      void handleDesktopAuthCallback(authCallback).catch((error) => {
        log.error('Failed to handle Better Auth callback:', error)
      })
    } else {
      handleDeepLinkArgv(argv)
    }
    handleMediaArgv(argv)
    activateMainWindow()
  })
} else {
  app.quit()
}

app.on('child-process-gone', (_event, details) => {
  if (isQuitting || details.reason === 'clean-exit') {
    return
  }

  log.error(
    `Electron child process gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode} service=${details.serviceName ?? details.name ?? 'unknown'}`
  )
  captureMainMessage(
    'Electron child process gone',
    {
      extra: {
        exit_code: details.exitCode,
        name: details.name,
        service_name: details.serviceName
      },
      tags: {
        process_type: details.type,
        reason: details.reason,
        source: 'electron.child-process-gone'
      }
    },
    'error'
  )

  const window = mainWindow
  if (
    process.platform === 'win32' &&
    details.type === 'GPU' &&
    window &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed() &&
    window.webContents.getURL().includes('/transcript')
  ) {
    recoverRendererToHome(window, `GPU ${details.reason}`)
  }
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (isDesktopAuthCallback(url)) {
    activateMainWindow()
    void handleDesktopAuthCallback(url).catch((error) => {
      log.error('Failed to handle Better Auth callback:', error)
    })
  } else {
    handleDeepLinkUrl(url)
  }
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  queueMediaImport(filePath)
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.vidbee')
  settingsManager.applyFreshInstallLocale()

  registerVidbeeProtocol()

  if (isPortableMode) {
    log.info(`Portable mode is active, skipping ${APP_PROTOCOL} protocol handler registration`)
  } else {
    const registered = app.setAsDefaultProtocolClient(APP_PROTOCOL)
    if (!registered) {
      log.warn(`Failed to register ${APP_PROTOCOL} protocol handler`)
    }

    if (!allowMultipleInstances) {
      const authRegistered = registerDesktopAuthProtocol()
      if (!authRegistered) {
        log.warn(`Failed to register ${AUTH_PROTOCOL} protocol handler`)
      }
    }
  }

  const initialAuthCallback = process.argv.find(isDesktopAuthCallback)
  if (initialAuthCallback) {
    try {
      await handleDesktopAuthCallback(initialAuthCallback)
    } catch (error) {
      log.error('Failed to handle initial Better Auth callback:', error)
    }
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)

    // Electron Toolkit already handles F12 in development.
    if (app.isPackaged) {
      window.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || input.code !== 'F12' || input.isAutoRepeat) {
          return
        }

        event.preventDefault()
        window.webContents.toggleDevTools()
      })
    }
  })

  // IPC services are automatically registered by electron-ipc-decorator when imported
  log.info('IPC services available:', Object.keys(services))

  const ffmpegInitialization = initializeOptionalTool({
    initialize: () => ffmpegManager.initialize(),
    label: 'ffmpeg',
    logger: log
  })
  const kernelService = initializeYtDlpKernelService()
  kernelService.on('status', handleYtDlpKernelStatus)
  const kernelPreparation = KERNEL_PREPARATION_PREVIEW
    ? Promise.resolve(false)
    : kernelService.prepare()

  if (KERNEL_PREPARATION_PREVIEW) {
    log.info('Kernel preparation preview is active')
  }

  // Create the renderer immediately so first-time preparation has visible feedback.
  createWindow()
  // Transcription models download in the background so yt-dlp can finish first.
  startIdleMinimalModelFill()

  await Promise.all([ffmpegInitialization, kernelPreparation])

  // NEX-131 A段: copy any pre-existing download-session.json + legacy
  // download_history rows into the new task-queue tasks table. Idempotent;
  // safe to run on every boot. Non-fatal if it fails.
  try {
    runDesktopTaskQueueMigration()
  } catch (err) {
    log.warn('Desktop task-queue migration failed:', err)
  }

  try {
    await startDesktopTaskQueue()
    startAutoTranscription()
    subscribeTranscriptBroadcasts()
    startIdleMinimalModelFill()
    isTaskQueueReady = true
    handleMediaArgv(process.argv)
    void flushPendingMediaImports()
  } catch (err) {
    log.warn('Desktop task-queue / transcription failed to start:', err)
  }

  await startExtensionApiServer()

  if (BACKGROUND_MODE) {
    addMainBreadcrumb('app', 'Started in --background tray-only mode')
    log.info('Desktop launched with --background; main window will stay hidden')
  }

  applyAutoLaunchSetting(settingsManager.get('launchAtLogin'))

  initAutoUpdater()

  // Create system tray
  createTray()

  try {
    await startDesktopSubscriptions()
  } catch (err) {
    log.warn('Desktop subscriptions failed to start:', err)
  }

  handleDeepLinkArgv(process.argv)
  handleMediaArgv(process.argv)
  void flushPendingMediaImports()

  app.on('activate', () => {
    const existingWindow = BrowserWindow.getAllWindows().find(isAppWindow)
    if (existingWindow) {
      if (existingWindow.isMinimized()) {
        existingWindow.restore()
      }
      if (!existingWindow.isVisible()) {
        existingWindow.show()
      }
      existingWindow.focus()
      return
    }

    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    createWindow()
  })
})

app.on('before-quit', (event) => {
  const rendererFailed =
    isRendererUnresponsive || (mainWindow ? isRendererUnavailable(mainWindow) : false)
  if (!rendererFailed && deferAppQuitIfNeeded()) {
    event.preventDefault()
    return
  }

  if (rendererFailed) {
    log.warn('Skipping quit confirmation because the renderer is unavailable')
  }

  if (!promptRunsStoppedForQuit) {
    event.preventDefault()
    isQuitting = true
    if (!promptRunsStoppingForQuit) {
      promptRunsStoppingForQuit = true
      void Promise.all([stopAllPromptRuns(), stopAllAgentRuns()]).finally(() => {
        promptRunsStoppedForQuit = true
        app.quit()
      })
    }
    return
  }

  isQuitting = true
  stopYtDlpKernelService()
  downloadEngine.flushDownloadSession()
  void stopPlayerHost()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  const closeToTray = settingsManager.get('closeToTray')

  if (process.platform !== 'darwin') {
    if (closeToTray) {
      // Hide to tray instead of quitting
      const mainWindow = BrowserWindow.getAllWindows().find(isAppWindow)
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
  destroyShareCaptureWindow()
  destroyTray()
  void stopExtensionApiServer()
  void stopDesktopSubscriptions().catch((err) =>
    log.warn('Failed to stop desktop subscriptions on quit:', err)
  )
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
