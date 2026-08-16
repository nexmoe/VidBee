/**
 * Public surface for the rpc-router and server bootstrap. Re-exports the
 * TaskQueueAPI singleton (and lifecycle hooks) that replaces the previous
 * `DownloaderCore` instance after NEX-131.
 *
 * The legacy `DownloaderCore` class is no longer instantiated by the API;
 * routes that need yt-dlp metadata (videoInfo / playlist.info) use the
 * stateless `fetchVideoInfo` / `fetchPlaylistInfo` helpers in
 * `./yt-dlp-info.ts`.
 */
// biome-ignore lint/performance/noBarrelFile: This module is the backward-compatible API facade.
export {
  apiDefaultDownloadDir as downloadDir,
  apiMaxConcurrent as maxConcurrent,
  isTaskQueuePersistent,
  startTaskQueue,
  stopTaskQueue,
  taskQueue,
  taskQueueExecutor
} from './task-queue-host'
