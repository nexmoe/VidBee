import { z } from 'zod'

export const DownloadTypeSchema = z.enum(['video', 'audio'])
export const DownloadStatusSchema = z.enum([
  'pending',
  'downloading',
  'processing',
  'completed',
  'error',
  'cancelled'
])

export const DownloadProgressSchema = z.object({
  percent: z.number(),
  currentSpeed: z.string().optional(),
  eta: z.string().optional(),
  downloaded: z.string().optional(),
  total: z.string().optional()
})

export const DownloadTaskSchema = z.object({
  id: z.string(),
  url: z.url(),
  title: z.string().optional(),
  thumbnail: z.string().optional(),
  type: DownloadTypeSchema,
  status: DownloadStatusSchema,
  createdAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  duration: z.number().optional(),
  fileSize: z.number().optional(),
  speed: z.string().optional(),
  ytDlpCommand: z.string().optional(),
  ytDlpLog: z.string().optional(),
  downloadPath: z.string().optional(),
  savedFileName: z.string().optional(),
  description: z.string().optional(),
  channel: z.string().optional(),
  uploader: z.string().optional(),
  viewCount: z.number().optional(),
  tags: z.array(z.string()).optional(),
  selectedFormat: z.lazy(() => VideoFormatSchema).optional(),
  playlistId: z.string().optional(),
  playlistTitle: z.string().optional(),
  playlistIndex: z.number().optional(),
  playlistSize: z.number().optional(),
  progress: DownloadProgressSchema.optional(),
  error: z.string().optional()
})

export const DownloadRuntimeSettingsSchema = z.object({
  downloadPath: z.string().optional(),
  browserForCookies: z.string().optional(),
  cookiesPath: z.string().optional(),
  proxy: z.string().optional(),
  configPath: z.string().optional(),
  embedSubs: z.boolean().optional(),
  embedThumbnail: z.boolean().optional(),
  embedMetadata: z.boolean().optional(),
  embedChapters: z.boolean().optional()
})

export const OneClickQualityPresetSchema = z.enum([
  'best',
  'good',
  'normal',
  'bad',
  'worst'
])

export const ThemeValueSchema = z.enum(['light', 'dark', 'system'])

export const WebAppSettingsSchema = z.object({
  downloadPath: z.string(),
  maxConcurrentDownloads: z.number().int().min(1).max(10),
  browserForCookies: z.string(),
  cookiesPath: z.string(),
  proxy: z.string(),
  configPath: z.string(),
  betaProgram: z.boolean(),
  language: z.string(),
  theme: ThemeValueSchema,
  oneClickDownload: z.boolean(),
  oneClickDownloadType: DownloadTypeSchema,
  oneClickQuality: OneClickQualityPresetSchema,
  closeToTray: z.boolean(),
  autoUpdate: z.boolean(),
  subscriptionOnlyLatestDefault: z.boolean(),
  enableAnalytics: z.boolean(),
  embedSubs: z.boolean(),
  embedThumbnail: z.boolean(),
  embedMetadata: z.boolean(),
  embedChapters: z.boolean(),
  shareWatermark: z.boolean()
})

export const CreateDownloadInputSchema = z.object({
  url: z.url(),
  type: DownloadTypeSchema,
  title: z.string().optional(),
  thumbnail: z.string().optional(),
  duration: z.number().optional(),
  description: z.string().optional(),
  channel: z.string().optional(),
  uploader: z.string().optional(),
  viewCount: z.number().optional(),
  tags: z.array(z.string()).optional(),
  selectedFormat: z.lazy(() => VideoFormatSchema).optional(),
  playlistId: z.string().optional(),
  playlistTitle: z.string().optional(),
  playlistIndex: z.number().optional(),
  playlistSize: z.number().optional(),
  format: z.string().optional(),
  audioFormat: z.string().optional(),
  audioFormatIds: z.array(z.string()).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  customDownloadPath: z.string().optional(),
  customFilenameTemplate: z.string().optional(),
  settings: DownloadRuntimeSettingsSchema.optional()
})

export const VideoInfoInputSchema = z.object({
  url: z.url(),
  settings: DownloadRuntimeSettingsSchema.optional()
})

export const PlaylistInfoInputSchema = z.object({
  url: z.url(),
  settings: DownloadRuntimeSettingsSchema.optional()
})

export const VideoFormatSchema = z.object({
  formatId: z.string(),
  ext: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  fps: z.number().optional(),
  vcodec: z.string().optional(),
  acodec: z.string().optional(),
  filesize: z.number().optional(),
  filesizeApprox: z.number().optional(),
  formatNote: z.string().optional(),
  tbr: z.number().optional(),
  quality: z.number().optional(),
  protocol: z.string().optional(),
  language: z.string().optional(),
  videoExt: z.string().optional(),
  audioExt: z.string().optional()
})

export const VideoInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  thumbnail: z.string().optional(),
  duration: z.number().optional(),
  extractorKey: z.string().optional(),
  webpageUrl: z.string().optional(),
  description: z.string().optional(),
  viewCount: z.number().optional(),
  uploader: z.string().optional(),
  tags: z.array(z.string()).optional(),
  formats: z.array(VideoFormatSchema)
})

export const PlaylistEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.url(),
  index: z.number(),
  thumbnail: z.string().optional()
})

export const PlaylistInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  entries: z.array(PlaylistEntrySchema),
  entryCount: z.number()
})

export const PlaylistDownloadInputSchema = z.object({
  url: z.url(),
  type: DownloadTypeSchema,
  format: z.string().optional(),
  audioFormat: z.string().optional(),
  audioFormatIds: z.array(z.string()).optional(),
  customDownloadPath: z.string().optional(),
  customFilenameTemplate: z.string().optional(),
  entryIds: z.array(z.string()).optional(),
  startIndex: z.number().int().positive().optional(),
  endIndex: z.number().int().positive().optional(),
  settings: DownloadRuntimeSettingsSchema.optional()
})

export const PlaylistDownloadEntrySchema = z.object({
  downloadId: z.string(),
  entryId: z.string(),
  title: z.string(),
  url: z.url(),
  index: z.number()
})

export const PlaylistDownloadResultSchema = z.object({
  groupId: z.string(),
  playlistId: z.string(),
  playlistTitle: z.string(),
  type: DownloadTypeSchema,
  totalCount: z.number(),
  startIndex: z.number(),
  endIndex: z.number(),
  entries: z.array(PlaylistDownloadEntrySchema)
})

export const StatusOutputSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  active: z.number(),
  pending: z.number()
})

export const CreateDownloadOutputSchema = z.object({
  download: DownloadTaskSchema
})

export const ListDownloadsOutputSchema = z.object({
  downloads: z.array(DownloadTaskSchema)
})

export const CancelDownloadInputSchema = z.object({
  id: z.string()
})

export const CancelDownloadOutputSchema = z.object({
  cancelled: z.boolean()
})

export const ListHistoryOutputSchema = z.object({
  history: z.array(DownloadTaskSchema)
})

export const VideoInfoOutputSchema = z.object({
  video: VideoInfoSchema
})

export const PlaylistInfoOutputSchema = z.object({
  playlist: PlaylistInfoSchema
})

export const PlaylistDownloadOutputSchema = z.object({
  result: PlaylistDownloadResultSchema
})

export const RemoveHistoryItemsInputSchema = z.object({
  ids: z.array(z.string()).min(1)
})

export const RemoveHistoryByPlaylistInputSchema = z.object({
  playlistId: z.string().min(1)
})

export const RemoveHistoryOutputSchema = z.object({
  removed: z.number().int().nonnegative()
})

export const FilePathInputSchema = z.object({
  path: z.string().min(1)
})

export const DirectoryListInputSchema = z.object({
  path: z.string().optional()
})

export const UploadSettingsFileKindSchema = z.enum(['cookies', 'config'])

export const UploadSettingsFileInputSchema = z.object({
  kind: UploadSettingsFileKindSchema,
  fileName: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(1_000_000)
})

export const FileExistsOutputSchema = z.object({
  exists: z.boolean()
})

export const FileOperationOutputSchema = z.object({
  success: z.boolean()
})

export const DirectoryEntrySchema = z.object({
  name: z.string(),
  path: z.string()
})

export const ListDirectoriesOutputSchema = z.object({
  currentPath: z.string(),
  parentPath: z.string().nullable(),
  directories: z.array(DirectoryEntrySchema)
})

export const UploadSettingsFileOutputSchema = z.object({
  path: z.string()
})

export const GetWebSettingsOutputSchema = z.object({
  settings: WebAppSettingsSchema
})

export const SetWebSettingsInputSchema = z.object({
  settings: WebAppSettingsSchema
})
