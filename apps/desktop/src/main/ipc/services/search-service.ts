import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import { emptyContentSearchResults } from '../../../shared/content-search'
import { searchDesktopContent } from '../../lib/desktop-search'

class SearchService extends IpcService {
  static readonly groupName = 'search'
  private readonly pending = new Map<number, AbortController>()

  /** Cancel the sender's previous query and return bounded public-text matches. */
  @IpcMethod()
  async content(context: IpcContext, query: string) {
    const senderId = context.sender.id
    this.pending.get(senderId)?.abort()
    if (query === '') {
      this.pending.delete(senderId)
      return emptyContentSearchResults()
    }
    const controller = new AbortController()
    this.pending.set(senderId, controller)
    /** Stop scanning if the palette's renderer is destroyed. */
    const abort = (): void => controller.abort()
    context.sender.once('destroyed', abort)
    try {
      return await searchDesktopContent(query, controller.signal)
    } finally {
      context.sender.removeListener('destroyed', abort)
      if (this.pending.get(senderId) === controller) {
        this.pending.delete(senderId)
      }
    }
  }
}

export { SearchService }
