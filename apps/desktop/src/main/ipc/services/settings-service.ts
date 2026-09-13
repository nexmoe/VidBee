import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { AppSettings } from '../../../shared/types'
import { refreshAppIconMenus } from '../../lib/app-icon-menu'
import {
  applyBatchSettingSideEffects,
  applySingleSettingSideEffects
} from '../../lib/settings-effects'
import { applyDesktopQueueConcurrency } from '../../lib/task-queue-host'
import { applyUpdateChannel } from '../../lib/update-channel'
import { settingsManager } from '../../settings'
import { applyAutoLaunchSetting } from '../../utils/auto-launch'
import { applyDockVisibility } from '../../utils/dock'

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

class SettingsService extends IpcService {
  static readonly groupName = 'settings'

  @IpcMethod()
  get<K extends keyof AppSettings>(_context: IpcContext, key: K): AppSettings[K] {
    return settingsManager.get(key)
  }

  @IpcMethod()
  set<K extends keyof AppSettings>(_context: IpcContext, key: K, value: AppSettings[K]): void {
    settingsManager.set(key, value)
    applySingleSettingSideEffects(key, value, settingSideEffectHandlers)
  }

  @IpcMethod()
  getAll(_context: IpcContext): AppSettings {
    return settingsManager.getAll()
  }

  @IpcMethod()
  setAll(_context: IpcContext, settings: Partial<AppSettings>): void {
    settingsManager.setAll(settings)
    applyBatchSettingSideEffects(settings, settingSideEffectHandlers)
  }

  @IpcMethod()
  reset(_context: IpcContext): void {
    settingsManager.reset()
    applyDockVisibility(settingsManager.get('hideDockIcon'))
    applyAutoLaunchSetting(settingsManager.get('launchAtLogin'))
    applyDesktopQueueConcurrency()
    applyUpdateChannel()
  }

  /**
   * True when a returning user should see the current What's New card.
   */
  @IpcMethod()
  shouldPromptWhatsNew(_context: IpcContext): boolean {
    return settingsManager.shouldPromptWhatsNew()
  }

  /**
   * Record that the current What's New card has been dismissed.
   */
  @IpcMethod()
  markWhatsNewSeen(_context: IpcContext): void {
    settingsManager.markWhatsNewSeen()
  }
}

export { SettingsService }
