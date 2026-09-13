import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import { createServices, type MergeIpcService } from 'electron-ipc-decorator'
import { AccountService } from './services/account-service'
import { AiService } from './services/ai-service'
import { AppService } from './services/app-service'
import { BrowserCookiesService } from './services/browser-cookies-service'
import { DownloadService } from './services/download-service'
import { FileSystemService } from './services/file-system-service'
import { HistoryService } from './services/history-service'
import { PlayerService } from './services/player-service'
import { SettingsService } from './services/settings-service'
import { SubscriptionService } from './services/subscription-service'
import { ThumbnailService } from './services/thumbnail-service'
import { TranscriptService } from './services/transcript-service'
import { UpdateService } from './services/update-service'
import { WindowService } from './services/window-service'

/**
 * Replace a live channel instead of throwing, so main HMR can attach methods
 * added after the first `createServices()` call.
 */
const registerIpcHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = ((
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
) => {
  ipcMain.removeHandler(channel)
  return registerIpcHandle(channel, listener)
}) as typeof ipcMain.handle

// Create services with automatic type inference
export const services = createServices([
  AccountService,
  AiService,
  AppService,
  BrowserCookiesService,
  DownloadService,
  FileSystemService,
  HistoryService,
  PlayerService,
  SettingsService,
  SubscriptionService,
  ThumbnailService,
  TranscriptService,
  UpdateService,
  WindowService
])

ipcMain.removeHandler('fs.saveMarkdownPdf')
ipcMain.handle('fs.saveMarkdownPdf', (event, options) =>
  services.fs.saveMarkdownPdf({ event, sender: event.sender }, options)
)

// Generate type definition for all services
export type IpcServices = MergeIpcService<typeof services>
