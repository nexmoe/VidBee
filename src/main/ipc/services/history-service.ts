import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { DownloadHistoryItem } from '../../../shared/types'
import { historyManager } from '../../lib/history-manager'

class HistoryService extends IpcService {
  static readonly groupName = 'history'

  @IpcMethod()
  getHistory(_context: IpcContext): DownloadHistoryItem[] {
    return historyManager.getHistory()
  }

  @IpcMethod()
  getHistoryById(_context: IpcContext, id: string): DownloadHistoryItem | undefined {
    return historyManager.getHistoryById(id)
  }

  @IpcMethod()
  addHistoryItem(_context: IpcContext, item: DownloadHistoryItem): void {
    historyManager.addHistoryItem(item)
  }

  @IpcMethod()
  removeHistoryItem(_context: IpcContext, id: string): boolean {
    return historyManager.removeHistoryItem(id)
  }

  @IpcMethod()
  getHistoryCount(_context: IpcContext): {
    active: number
    completed: number
    error: number
    cancelled: number
    total: number
  } {
    return historyManager.getHistoryCount()
  }
}

export { HistoryService }
