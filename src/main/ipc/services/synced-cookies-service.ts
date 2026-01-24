import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import { listSyncedCookies } from '../../lib/synced-cookies-store'

class SyncedCookiesService extends IpcService {
  static readonly groupName = 'syncedCookies'

  @IpcMethod()
  list(_context: IpcContext) {
    return listSyncedCookies()
  }
}

export { SyncedCookiesService }
