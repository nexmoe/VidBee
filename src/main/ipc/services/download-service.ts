import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type {
  DownloadItem,
  DownloadOptions,
  PlaylistDownloadOptions,
  PlaylistDownloadResult,
  PlaylistInfo,
  VideoInfo
} from '../../../shared/types'
import { downloadEngine } from '../../lib/download-engine'

class DownloadService extends IpcService {
  static readonly groupName = 'download'

  @IpcMethod()
  async getVideoInfo(_context: IpcContext, url: string): Promise<VideoInfo> {
    return downloadEngine.getVideoInfo(url)
  }

  @IpcMethod()
  async getPlaylistInfo(_context: IpcContext, url: string): Promise<PlaylistInfo> {
    return downloadEngine.getPlaylistInfo(url)
  }

  @IpcMethod()
  startDownload(_context: IpcContext, id: string, options: DownloadOptions): void {
    downloadEngine.startDownload(id, options)
  }

  @IpcMethod()
  cancelDownload(_context: IpcContext, id: string): boolean {
    return downloadEngine.cancelDownload(id)
  }

  @IpcMethod()
  getQueueStatus(_context: IpcContext) {
    return downloadEngine.getQueueStatus()
  }

  @IpcMethod()
  updateDownloadInfo(_context: IpcContext, id: string, updates: Partial<DownloadItem>): void {
    downloadEngine.updateDownloadInfo(id, updates)
  }

  @IpcMethod()
  async startPlaylistDownload(
    _context: IpcContext,
    options: PlaylistDownloadOptions
  ): Promise<PlaylistDownloadResult> {
    return downloadEngine.startPlaylistDownload(options)
  }
}

export { DownloadService }
