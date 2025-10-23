import os from 'node:os'
import path from 'node:path'
import type { AppSettings } from '../shared/types'
import { defaultSettings } from '../shared/types'

// Use require for electron-store to avoid CommonJS/ESM issues
const ElectronStore = require('electron-store')
// Access the default export
const Store = ElectronStore.default || ElectronStore

class SettingsManager {
  // biome-ignore lint/suspicious/noExplicitAny: electron-store requires dynamic import
  private store: any

  constructor() {
    this.store = new Store({
      defaults: {
        ...defaultSettings,
        downloadPath: path.join(os.homedir(), 'Downloads')
      }
    })
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.store.get(key)
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.store.set(key, value)
  }

  getAll(): AppSettings {
    return this.store.store
  }

  setAll(settings: Partial<AppSettings>): void {
    for (const [key, value] of Object.entries(settings)) {
      this.store.set(key as keyof AppSettings, value as AppSettings[keyof AppSettings])
    }
  }

  reset(): void {
    this.store.clear()
    this.store.set({
      ...defaultSettings,
      downloadPath: path.join(os.homedir(), 'Downloads')
    })
  }
}

export const settingsManager = new SettingsManager()
