import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { AppSettings } from '../../../shared/types'
import { subscriptionScheduler } from '../../lib/subscription-scheduler'
import { settingsManager } from '../../settings'
import { updateTrayMenu } from '../../tray'
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
    settingsManager.set(key, value)

    if (key === 'language') {
      updateTrayMenu()
    }

    if (key === 'hideDockIcon') {
      applyDockVisibility(value as AppSettings['hideDockIcon'])
    }

    if (key === 'launchAtLogin') {
      applyAutoLaunchSetting(value as AppSettings['launchAtLogin'])
    }

    if (key === 'subscriptionCheckIntervalHours') {
      subscriptionScheduler.refreshInterval()
    }
  }

  @IpcMethod()
  getAll(_context: IpcContext): AppSettings {
    return settingsManager.getAll()
  }

  @IpcMethod()
  setAll(_context: IpcContext, settings: Partial<AppSettings>): void {
    settingsManager.setAll(settings)

    if (settings.language) {
      updateTrayMenu()
    }

    if (typeof settings.hideDockIcon === 'boolean') {
      applyDockVisibility(settings.hideDockIcon)
    }

    if (typeof settings.launchAtLogin === 'boolean') {
      applyAutoLaunchSetting(settings.launchAtLogin)
    }

    if (settings.subscriptionCheckIntervalHours !== undefined) {
      subscriptionScheduler.refreshInterval()
    }
  }

  @IpcMethod()
  reset(_context: IpcContext): void {
    settingsManager.reset()
    applyDockVisibility(settingsManager.get('hideDockIcon'))
    applyAutoLaunchSetting(settingsManager.get('launchAtLogin'))
    subscriptionScheduler.refreshInterval()
  }
}

export { SettingsService }
