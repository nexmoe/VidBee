// Download related types
export interface VideoFormat {
  format_id: string
  ext: string
  height?: number
  width?: number
  fps?: number
  vcodec?: string
  acodec?: string
  filesize?: number
  filesize_approx?: number
  format_note?: string
  video_ext?: string
  audio_ext?: string
  tbr?: number
  quality?: number
}

export interface VideoInfo {
  id: string
  title: string
  thumbnail?: string
  duration?: number
  formats: VideoFormat[]
  extractor_key?: string
  webpage_url?: string
  description?: string
  view_count?: number
  uploader?: string
}

export interface DownloadProgress {
  percent: number
  currentSpeed?: string
  eta?: string
  downloaded?: string
  total?: string
}

export type DownloadStatus =
  | 'pending'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'error'
  | 'cancelled'

export interface DownloadItem {
  id: string
  url: string
  title: string
  thumbnail?: string
  type: 'video' | 'audio' | 'extract'
  status: DownloadStatus
  progress?: DownloadProgress
  error?: string
  speed?: string
  // Enhanced video information
  duration?: number
  fileSize?: number
  format?: string
  quality?: string
  codec?: string
  // Timestamps
  createdAt: number
  startedAt?: number
  completedAt?: number
  // Additional metadata
  description?: string
  channel?: string
  uploader?: string
  viewCount?: number
  tags?: string[]
  // Download-specific format info
  selectedFormat?: VideoFormat
}

export interface DownloadHistoryItem {
  id: string
  url: string
  title: string
  thumbnail?: string
  type: 'video' | 'audio' | 'extract'
  status: DownloadStatus
  downloadPath?: string
  fileSize?: number
  duration?: number
  downloadedAt: number
  completedAt?: number
  error?: string
  // Enhanced video information
  format?: string
  quality?: string
  codec?: string
  // Additional metadata
  description?: string
  channel?: string
  uploader?: string
  viewCount?: number
  tags?: string[]
  // Download-specific format info
  selectedFormat?: VideoFormat
}

export interface DownloadOptions {
  url: string
  type: 'video' | 'audio' | 'extract'
  format?: string
  audioFormat?: string
  extractFormat?: string
  extractQuality?: string
  startTime?: string
  endTime?: string
  downloadSubs?: boolean
}

export interface PlaylistInfo {
  id: string
  title: string
  entries: Array<{
    id: string
    title: string
    url: string
  }>
  entryCount: number
}

export interface PlaylistDownloadOptions {
  url: string
  type: 'video' | 'audio'
  format?: string
  startIndex?: number
  endIndex?: number
  filenameFormat?: string
  folderFormat?: string
}

// Settings types
export type OneClickQualityPreset = 'auto' | 'best' | 'good' | 'normal' | 'bad' | 'worst'

export interface AppSettings {
  downloadPath: string
  showMoreFormats: boolean
  maxConcurrentDownloads: number
  browserForCookies: string
  proxy: string
  configPath: string
  betaProgram: boolean
  language: string
  theme: string
  oneClickDownload: boolean
  oneClickDownloadType: 'video' | 'audio'
  oneClickQuality: OneClickQualityPreset
  closeToTray: boolean
  autoUpdate: boolean
}

export const defaultSettings: AppSettings = {
  downloadPath: '',
  showMoreFormats: false,
  maxConcurrentDownloads: 5,
  browserForCookies: 'none',
  proxy: '',
  configPath: '',
  betaProgram: false,
  language: 'en',
  theme: 'system',
  oneClickDownload: false,
  oneClickDownloadType: 'video',
  oneClickQuality: 'auto',
  closeToTray: false,
  autoUpdate: true
}
