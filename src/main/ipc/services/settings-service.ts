import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { AppSettings } from '../../../shared/types'
import { sanitizeFilenameTemplate } from '../../download-engine/args-builder'
import { subscriptionScheduler } from '../../lib/subscription-scheduler'
import { settingsManager } from '../../settings'
import { updateTrayMenu } from '../../tray'
import { applyAutoLaunchSetting } from '../../utils/auto-launch'
import { applyDockVisibility } from '../../utils/dock'

class SettingsService extends IpcService {
  static readonly groupName = 'settings'

  @IpcMethod()
  get<K extends keyof AppSettings>(_context: IpcContext, key: K): AppSettings[K] {
    const value = settingsManager.get(key)
    if (key === 'subscriptionFilenameTemplate' && typeof value === 'string') {
      return sanitizeFilenameTemplate(value) as AppSettings[K]
    }
    return value
  }

  @IpcMethod()
  set<K extends keyof AppSettings>(_context: IpcContext, key: K, value: AppSettings[K]): void {
    if (key === 'subscriptionFilenameTemplate' && typeof value === 'string') {
      settingsManager.set(key, sanitizeFilenameTemplate(value) as AppSettings[K])
    } else {
      settingsManager.set(key, value)
    }

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
    const settings = settingsManager.getAll()
    if (typeof settings.subscriptionFilenameTemplate === 'string') {
      settings.subscriptionFilenameTemplate = sanitizeFilenameTemplate(
        settings.subscriptionFilenameTemplate
      )
    }
    return settings
  }

  @IpcMethod()
  setAll(_context: IpcContext, settings: Partial<AppSettings>): void {
    if (typeof settings.subscriptionFilenameTemplate === 'string') {
      settings.subscriptionFilenameTemplate = sanitizeFilenameTemplate(
        settings.subscriptionFilenameTemplate
      )
    }
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
