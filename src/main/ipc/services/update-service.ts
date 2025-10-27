import { app } from 'electron'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import { autoUpdater } from 'electron-updater'
import { settingsManager } from '../../settings'

const isNewerVersion = (latest: string, current: string): boolean => {
  const toSegments = (version: string) =>
    version.split(/[.-]/).map((segment) => {
      const parsed = Number.parseInt(segment, 10)
      return Number.isNaN(parsed) ? 0 : parsed
    })

  const latestSegments = toSegments(latest)
  const currentSegments = toSegments(current)
  const maxLength = Math.max(latestSegments.length, currentSegments.length)

  for (let index = 0; index < maxLength; index += 1) {
    const latestValue = latestSegments[index] ?? 0
    const currentValue = currentSegments[index] ?? 0

    if (latestValue > currentValue) {
      return true
    }

    if (latestValue < currentValue) {
      return false
    }
  }

  return false
}

class UpdateService extends IpcService {
  static readonly groupName = 'update'

  @IpcMethod()
  async checkForUpdates(
    _context: IpcContext
  ): Promise<{ available: boolean; version?: string; error?: string }> {
    try {
      const currentVersion = app.getVersion()
      const result = await autoUpdater.checkForUpdates()
      const latestVersion = result?.updateInfo?.version

      if (latestVersion && isNewerVersion(latestVersion, currentVersion)) {
        return {
          available: true,
          version: latestVersion
        }
      }

      return {
        available: false,
        version: latestVersion ?? currentVersion
      }
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  @IpcMethod()
  async downloadUpdate(_context: IpcContext): Promise<{ success: boolean; error?: string }> {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  @IpcMethod()
  quitAndInstall(_context: IpcContext): void {
    autoUpdater.quitAndInstall()
  }

  @IpcMethod()
  getCurrentVersion(_context: IpcContext): string {
    return app.getVersion()
  }

  @IpcMethod()
  isAutoUpdateEnabled(_context: IpcContext): boolean {
    return settingsManager.get('autoUpdate')
  }
}

export { UpdateService }
