import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AppSettings } from '../shared/types'
import { defaultSettings } from '../shared/types'
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

const resolveDefaultDownloadPath = () => {
  return path.join(os.homedir(), 'Downloads', 'VidBee')
}

const DEFAULT_DOWNLOAD_PATH = resolveDefaultDownloadPath()

class SettingsManager {
  // biome-ignore lint/suspicious/noExplicitAny: electron-store requires dynamic import
  private store: any

  constructor() {
    this.store = new Store({
      defaults: {
        ...defaultSettings,
        downloadPath: DEFAULT_DOWNLOAD_PATH
      }
    })
    this.ensureDownloadDirectory()
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.store.get(key)
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    if (key === 'downloadPath' && typeof value === 'string') {
      ensureDirectoryExists(value)
    }
    this.store.set(key, value)
  }

  getAll(): AppSettings {
    return {
      ...defaultSettings,
      downloadPath: DEFAULT_DOWNLOAD_PATH,
      ...this.store.store
    }
  }

  setAll(settings: Partial<AppSettings>): void {
    for (const [key, value] of Object.entries(settings)) {
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
      downloadPath: DEFAULT_DOWNLOAD_PATH
    })
  }

  private ensureDownloadDirectory(): void {
    try {
      const currentPath: string | undefined = this.store.get('downloadPath')
      const normalizedDownloadPath =
        !currentPath || currentPath === OLD_DEFAULT_DOWNLOAD_PATH
          ? DEFAULT_DOWNLOAD_PATH
          : currentPath
      if (normalizedDownloadPath !== currentPath) {
        this.store.set('downloadPath', normalizedDownloadPath)
      }
    } catch (error) {
      scopedLoggers.system.error('Failed to verify download directory:', error)
    }
  }
}

export const settingsManager = new SettingsManager()
