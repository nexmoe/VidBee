import { createServices, type MergeIpcService } from 'electron-ipc-decorator'
import { AppService } from './services/app-service'
import { DownloadService } from './services/download-service'
import { FileSystemService } from './services/file-system-service'
import { HistoryService } from './services/history-service'
import { SettingsService } from './services/settings-service'
import { SubscriptionService } from './services/subscription-service'
import { ThumbnailService } from './services/thumbnail-service'
import { UpdateService } from './services/update-service'
import { WindowService } from './services/window-service'

// Create services with automatic type inference
export const services = createServices([
  AppService,
  DownloadService,
  FileSystemService,
  HistoryService,
  SettingsService,
  SubscriptionService,
  ThumbnailService,
  UpdateService,
  WindowService
])

// Generate type definition for all services
export type IpcServices = MergeIpcService<typeof services>
