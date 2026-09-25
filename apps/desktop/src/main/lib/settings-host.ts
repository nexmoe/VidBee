import { BrowserWindow } from 'electron'
import type { AppSettings } from '../../shared/types'
import { settingsManager } from '../settings'
import { applyAutoLaunchSetting } from '../utils/auto-launch'
import { applyDockVisibility } from '../utils/dock'
import { refreshAppIconMenus } from './app-icon-menu'
import { applyBatchSettingSideEffects } from './settings-effects'
import { applyDesktopQueueConcurrency } from './task-queue-host'

const settingSideEffectHandlers = {
  onLanguage: () => {
    refreshAppIconMenus()
  },
  onHideDockIcon: (value: boolean) => {
    applyDockVisibility(value)
  },
  onLaunchAtLogin: (value: boolean) => {
    applyAutoLaunchSetting(value)
  },
  onMaxConcurrentDownloads: () => {
    applyDesktopQueueConcurrency()
  },
  onMaxConcurrentTranscriptions: () => {
    applyDesktopQueueConcurrency()
  }
}

/** Publish changes made outside the settings screen to every open renderer. */
export function broadcastSettingsChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('settings:changed')
  }
}

/** Persist UI and Agent edits through the same application side effects. */
export function updateDesktopSettings(settings: Partial<AppSettings>): void {
  settingsManager.setAll(settings)
  const actual = settingsManager.getAll()
  const applied = Object.fromEntries(
    Object.keys(settings).map((key) => [key, actual[key as keyof AppSettings]])
  )
  applyBatchSettingSideEffects(applied, settingSideEffectHandlers)
  broadcastSettingsChanged()
}
