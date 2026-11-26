import { createServices } from 'electron-ipc-decorator'
import { TASK_QUEUE_DDL_V1 } from '../../../../packages/db/src/task-queue'
import { YtDlpExecutor } from '../../../../packages/downloader-core/src/yt-dlp-executor'
import { TaskQueueAPI } from '../../../../packages/task-queue/src/api/index'
import { SqlitePersistAdapter } from '../../../../packages/task-queue/src/persist/sqlite'
import { SettingsService } from '../../src/main/ipc/services/settings-service'
import { ThumbnailService } from '../../src/main/ipc/services/thumbnail-service'
import { prepareDownloadTaskInput } from '../../src/main/lib/download-facade'
import { thumbnailCache } from '../../src/main/lib/thumbnail-cache'
import { settingsManager } from '../../src/main/settings'

export const fixture = {
  createServices,
  TASK_QUEUE_DDL_V1,
  YtDlpExecutor,
  TaskQueueAPI,
  SqlitePersistAdapter,
  SettingsService,
  ThumbnailService,
  prepareDownloadTaskInput,
  thumbnailCache,
  settingsManager
}
