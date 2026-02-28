export type DownloadType = 'video' | 'audio'

export type DownloadStatus =
  | 'pending'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'error'
  | 'cancelled'

export interface DownloadProgress {
  percent: number
  currentSpeed?: string
  eta?: string
  downloaded?: string
  total?: string
}

export interface DownloadTask {
  id: string
  url: string
  title?: string
  thumbnail?: string
  type: DownloadType
  status: DownloadStatus
  createdAt: number
  startedAt?: number
  completedAt?: number
  duration?: number
  fileSize?: number
  speed?: string
  ytDlpCommand?: string
  ytDlpLog?: string
  downloadPath?: string
  savedFileName?: string
  description?: string
  channel?: string
  uploader?: string
  viewCount?: number
  tags?: string[]
  selectedFormat?: VideoFormat
  playlistId?: string
  playlistTitle?: string
  playlistIndex?: number
  playlistSize?: number
  progress?: DownloadProgress
  error?: string
}

export interface DownloadRuntimeSettings {
  downloadPath?: string
  browserForCookies?: string
  cookiesPath?: string
  proxy?: string
  configPath?: string
  embedSubs?: boolean
  embedThumbnail?: boolean
  embedMetadata?: boolean
  embedChapters?: boolean
}

export interface VideoInfoInput {
  url: string
  settings?: DownloadRuntimeSettings
}

export interface PlaylistInfoInput {
  url: string
  settings?: DownloadRuntimeSettings
}

export interface CreateDownloadInput {
  url: string
  type: DownloadType
  title?: string
  thumbnail?: string
  duration?: number
  description?: string
  channel?: string
  uploader?: string
  viewCount?: number
  tags?: string[]
  selectedFormat?: VideoFormat
  playlistId?: string
  playlistTitle?: string
  playlistIndex?: number
  playlistSize?: number
  format?: string
  audioFormat?: string
  audioFormatIds?: string[]
  startTime?: string
  endTime?: string
  customDownloadPath?: string
  customFilenameTemplate?: string
  settings?: DownloadRuntimeSettings
}

export interface VideoFormat {
  formatId: string
  ext: string
  width?: number
  height?: number
  fps?: number
  vcodec?: string
  acodec?: string
  filesize?: number
  filesizeApprox?: number
  formatNote?: string
  tbr?: number
  quality?: number
  protocol?: string
  language?: string
  videoExt?: string
  audioExt?: string
}

export interface VideoInfo {
  id: string
  title: string
  thumbnail?: string
  duration?: number
  extractorKey?: string
  webpageUrl?: string
  description?: string
  viewCount?: number
  uploader?: string
  tags?: string[]
  formats: VideoFormat[]
}

export interface PlaylistEntry {
  id: string
  title: string
  url: string
  index: number
  thumbnail?: string
}

export interface PlaylistInfo {
  id: string
  title: string
  entries: PlaylistEntry[]
  entryCount: number
}

export interface PlaylistDownloadInput {
  url: string
  type: DownloadType
  format?: string
  audioFormat?: string
  audioFormatIds?: string[]
  customDownloadPath?: string
  customFilenameTemplate?: string
  startIndex?: number
  endIndex?: number
  settings?: DownloadRuntimeSettings
}

export interface PlaylistDownloadEntry {
  downloadId: string
  entryId: string
  title: string
  url: string
  index: number
}

export interface PlaylistDownloadResult {
  groupId: string
  playlistId: string
  playlistTitle: string
  type: DownloadType
  totalCount: number
  startIndex: number
  endIndex: number
  entries: PlaylistDownloadEntry[]
}

export interface FilePathInput {
  path: string
}

export interface DirectoryListInput {
  path?: string
}

export interface DirectoryEntry {
  name: string
  path: string
}

export interface FileExistsOutput {
  exists: boolean
}

export interface FileOperationOutput {
  success: boolean
}

export interface ListDirectoriesOutput {
  currentPath: string
  parentPath: string | null
  directories: DirectoryEntry[]
}
