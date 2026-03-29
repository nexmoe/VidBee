import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { AppSettings } from '../../../shared/types'
import { downloadEngine } from '../../lib/download-engine'
import {
  applyBatchSettingSideEffects,
  applySingleSettingSideEffects
} from '../../lib/settings-effects'
import { settingsManager } from '../../settings'
import { updateTrayMenu } from '../../tray'
import { applyAutoLaunchSetting } from '../../utils/auto-launch'
import { applyDockVisibility } from '../../utils/dock'

const settingSideEffectHandlers = {
  onLanguage: () => {
    updateTrayMenu()
  },
  onHideDockIcon: (value: boolean) => {
    applyDockVisibility(value)
  },
  onLaunchAtLogin: (value: boolean) => {
    applyAutoLaunchSetting(value)
  },
  onMaxConcurrentDownloads: (value: number) => {
    downloadEngine.updateMaxConcurrent(value)
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
    downloadEngine.updateMaxConcurrent(settingsManager.get('maxConcurrentDownloads'))
  }
}

export { SettingsService }
