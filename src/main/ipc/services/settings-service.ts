import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { AppSettings } from '../../../shared/types'
import { settingsManager } from '../../settings'
import { updateTrayMenu } from '../../tray'

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
  }

  @IpcMethod()
  reset(_context: IpcContext): void {
    settingsManager.reset()
  }
}

export { SettingsService }
