import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import { thumbnailCache } from '../../lib/thumbnail-cache'

class ThumbnailService extends IpcService {
  static readonly groupName = 'thumbnail'

  @IpcMethod()
  async getThumbnailPath(
    _context: IpcContext,
    url: string | null | undefined
  ): Promise<string | null> {
    if (!url) {
      return null
    }

    return thumbnailCache.getThumbnailUrl(url)
  }
}

export { ThumbnailService }
