import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AppSettings } from '../shared/types'
import { defaultSettings } from '../shared/types'
import {
  getPortableDownloadsPath,
  isPortableMode,
  portableRoot,
  previousPortableRoot,
  rememberPortableRoot
} from './portable'
import { scopedLoggers } from './utils/logger'

// Use require for electron-store to avoid CommonJS/ESM issues
const ElectronStore = require('electron-store')
// Access the default export
const Store = ElectronStore.default || ElectronStore

const OLD_DEFAULT_DOWNLOAD_PATH = path.join(os.homedir(), 'Downloads')
const ensureDirectoryExists = (dir: string) => {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (error) {
    scopedLoggers.system.error('Failed to ensure download directory:', error)
  }
}

const isPathInsideOrEqual = (candidate: string, root: string): boolean => {
  if (!(candidate && root)) {
    return false
  }

  const relativePath = path.relative(path.resolve(root), path.resolve(candidate))
  return (
    relativePath === '' ||
    (!!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  )
}

const remapFromPreviousPortableRoot = (candidate: string): string => {
  if (!(previousPortableRoot && isPathInsideOrEqual(candidate, previousPortableRoot))) {
    return ''
  }

  return path.join(portableRoot, path.relative(previousPortableRoot, candidate))
}

const resolveDefaultDownloadPath = () => {
  if (isPortableMode) {
    return getPortableDownloadsPath()
  }

  return path.join(os.homedir(), 'Downloads', 'VidBee')
}

const DEFAULT_DOWNLOAD_PATH = resolveDefaultDownloadPath()
const REQUIRED_AUTO_UPDATE = !isPortableMode
const REQUIRED_LAUNCH_AT_LOGIN = false

class SettingsManager {
  // biome-ignore lint/suspicious/noExplicitAny: electron-store requires dynamic import
  private readonly store: any

  constructor() {
    this.store = new Store({
      defaults: {
        ...defaultSettings,
        downloadPath: DEFAULT_DOWNLOAD_PATH,
        autoUpdate: REQUIRED_AUTO_UPDATE,
        launchAtLogin: isPortableMode ? REQUIRED_LAUNCH_AT_LOGIN : defaultSettings.launchAtLogin
      }
    })
    this.ensureDownloadDirectory()
    this.ensureRequiredSettings()
    rememberPortableRoot()
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    if (key === 'autoUpdate') {
      return REQUIRED_AUTO_UPDATE as AppSettings[K]
    }

    if (isPortableMode && key === 'launchAtLogin') {
      return REQUIRED_LAUNCH_AT_LOGIN as AppSettings[K]
    }

    return this.store.get(key)
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    if (key === 'autoUpdate') {
      this.store.set(key, REQUIRED_AUTO_UPDATE)
      return
    }

    if (isPortableMode && key === 'launchAtLogin') {
      this.store.set(key, REQUIRED_LAUNCH_AT_LOGIN)
      return
    }

    if (key === 'downloadPath' && typeof value === 'string') {
      ensureDirectoryExists(value)
    }
    this.store.set(key, value)
  }

  getAll(): AppSettings {
    return {
      ...defaultSettings,
      downloadPath: DEFAULT_DOWNLOAD_PATH,
      ...this.store.store,
      autoUpdate: REQUIRED_AUTO_UPDATE,
      launchAtLogin: isPortableMode
        ? REQUIRED_LAUNCH_AT_LOGIN
        : (this.store.store.launchAtLogin ?? defaultSettings.launchAtLogin)
    }
  }

  setAll(settings: Partial<AppSettings>): void {
    for (const [key, value] of Object.entries(settings)) {
      if (key === 'autoUpdate') {
        this.store.set(key, REQUIRED_AUTO_UPDATE)
        continue
      }

      if (isPortableMode && key === 'launchAtLogin') {
        this.store.set(key, REQUIRED_LAUNCH_AT_LOGIN)
        continue
      }

      if (key === 'downloadPath' && typeof value === 'string') {
        ensureDirectoryExists(value)
      }
      this.store.set(key as keyof AppSettings, value as AppSettings[keyof AppSettings])
    }
  }

  reset(): void {
    this.store.clear()
    this.store.set({
      ...defaultSettings,
      downloadPath: DEFAULT_DOWNLOAD_PATH,
      autoUpdate: REQUIRED_AUTO_UPDATE,
      launchAtLogin: isPortableMode ? REQUIRED_LAUNCH_AT_LOGIN : defaultSettings.launchAtLogin
    })
  }

  private ensureDownloadDirectory(): void {
    try {
      const currentPath: string | undefined = this.store.get('downloadPath')
      let normalizedDownloadPath = currentPath || DEFAULT_DOWNLOAD_PATH

      if (!currentPath || currentPath === OLD_DEFAULT_DOWNLOAD_PATH) {
        normalizedDownloadPath = DEFAULT_DOWNLOAD_PATH
      } else if (isPortableMode) {
        const remappedPath = remapFromPreviousPortableRoot(currentPath)
        if (remappedPath) {
          normalizedDownloadPath = remappedPath
        } else if (!isPathInsideOrEqual(currentPath, portableRoot)) {
          normalizedDownloadPath = DEFAULT_DOWNLOAD_PATH
        }
      }

      if (normalizedDownloadPath !== currentPath) {
        this.store.set('downloadPath', normalizedDownloadPath)
      }
      ensureDirectoryExists(normalizedDownloadPath)
    } catch (error) {
      scopedLoggers.system.error('Failed to verify download directory:', error)
    }
  }

  private ensureRequiredSettings(): void {
    try {
      if (this.store.get('autoUpdate') !== REQUIRED_AUTO_UPDATE) {
        this.store.set('autoUpdate', REQUIRED_AUTO_UPDATE)
      }
      if (isPortableMode && this.store.get('launchAtLogin') !== REQUIRED_LAUNCH_AT_LOGIN) {
        this.store.set('launchAtLogin', REQUIRED_LAUNCH_AT_LOGIN)
      }
    } catch (error) {
      scopedLoggers.system.error('Failed to enforce required settings:', error)
    }
  }
}

export const settingsManager = new SettingsManager()
