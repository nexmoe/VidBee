import { app } from 'electron'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import { autoUpdater } from 'electron-updater'
import { settingsManager } from '../../settings'

class UpdateService extends IpcService {
  static readonly groupName = 'update'

  @IpcMethod()
  async checkForUpdates(
    _context: IpcContext
  ): Promise<{ available: boolean; version?: string; error?: string }> {
    try {
      // In production, use checkForUpdatesAndNotify for automatic notifications
      const result = await autoUpdater.checkForUpdatesAndNotify()
      return {
        available: result !== null,
        version: result?.updateInfo?.version
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
