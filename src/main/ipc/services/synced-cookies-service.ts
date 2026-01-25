import { dialog } from 'electron'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import {
  clearAllCookies,
  importCookiesFromFile,
  listSyncedCookies
} from '../../lib/synced-cookies-store'

class SyncedCookiesService extends IpcService {
  static readonly groupName = 'syncedCookies'

  @IpcMethod()
  list(_context: IpcContext) {
    return listSyncedCookies()
  }

  @IpcMethod()
  async import(_context: IpcContext) {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Netscape Cookie Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      title: 'Select Netscape Cookie File'
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const filePath = result.filePaths[0]
    return importCookiesFromFile(filePath)
  }

  @IpcMethod()
  clear(_context: IpcContext) {
    clearAllCookies()
  }
}

export { SyncedCookiesService }
