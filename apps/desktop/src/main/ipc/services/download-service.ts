import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type {
  DownloadItem,
  DownloadOptions,
  PlaylistDownloadOptions,
  PlaylistDownloadResult,
  PlaylistInfo,
  VideoInfo,
  VideoInfoCommandResult
} from '../../../shared/types'
import { downloadEngine } from '../../lib/download-facade'

class DownloadService extends IpcService {
  static readonly groupName = 'download'

  @IpcMethod()
  async getVideoInfo(_context: IpcContext, url: string): Promise<VideoInfo> {
    return downloadEngine.getVideoInfo(url)
  }

  @IpcMethod()
  async getVideoInfoWithCommand(
    _context: IpcContext,
    url: string
  ): Promise<VideoInfoCommandResult> {
    return downloadEngine.getVideoInfoWithCommand(url)
  }

  @IpcMethod()
  async getPlaylistInfo(_context: IpcContext, url: string): Promise<PlaylistInfo> {
    return downloadEngine.getPlaylistInfo(url)
  }

  @IpcMethod()
  startDownload(_context: IpcContext, id: string, options: DownloadOptions): boolean {
    return downloadEngine.startDownload(id, options)
  }

  @IpcMethod()
  cancelDownload(_context: IpcContext, id: string): boolean {
    return downloadEngine.cancelDownload(id)
  }

  /**
   * Pause a queued or in-flight download.
   *
   * @param _context IPC call context.
   * @param id Download id.
   * @returns false when the download is not in the queue.
   */
  @IpcMethod()
  pauseDownload(_context: IpcContext, id: string): boolean {
    return downloadEngine.pauseDownload(id)
  }

  /**
   * Resume a paused download from the last partial file.
   *
   * @param _context IPC call context.
   * @param id Download id.
   * @returns false when the download is not in the queue.
   */
  @IpcMethod()
  resumeDownload(_context: IpcContext, id: string): boolean {
    return downloadEngine.resumeDownload(id)
  }

  @IpcMethod()
  async retryDownload(_context: IpcContext, id: string): Promise<boolean> {
    return downloadEngine.retryDownload(id)
  }

  @IpcMethod()
  getQueueStatus(_context: IpcContext) {
    return downloadEngine.getQueueStatus()
  }

  @IpcMethod()
  getActiveDownloads(_context: IpcContext): DownloadItem[] {
    return downloadEngine.getActiveDownloads()
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
