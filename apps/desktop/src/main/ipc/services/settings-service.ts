import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { AppSettings } from '../../../shared/types'
import { updateDesktopSettings } from '../../lib/settings-host'
import { applyDesktopQueueConcurrency } from '../../lib/task-queue-host'
import { applyUpdateChannel } from '../../lib/update-channel'
import { settingsManager } from '../../settings'
import { applyAutoLaunchSetting } from '../../utils/auto-launch'
import { applyDockVisibility } from '../../utils/dock'

class SettingsService extends IpcService {
  static readonly groupName = 'settings'

  @IpcMethod()
  get<K extends keyof AppSettings>(_context: IpcContext, key: K): AppSettings[K] {
    return settingsManager.get(key)
  }

  @IpcMethod()
  set<K extends keyof AppSettings>(_context: IpcContext, key: K, value: AppSettings[K]): void {
    updateDesktopSettings({ [key]: value })
  }

  @IpcMethod()
  getAll(_context: IpcContext): AppSettings {
    return settingsManager.getAll()
  }

  @IpcMethod()
  setAll(_context: IpcContext, settings: Partial<AppSettings>): void {
    updateDesktopSettings(settings)
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
