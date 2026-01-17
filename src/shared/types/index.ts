import type { LanguageCode } from '../languages'
import { defaultLanguageCode } from '../languages'

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
  protocol?: string // http, https, m3u8, m3u8_native, etc.
  language?: string
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

export interface VideoInfoCommandResult {
  info?: VideoInfo
  ytDlpCommand: string
  error?: string
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
  type: 'video' | 'audio'
  status: DownloadStatus
  progress?: DownloadProgress
  error?: string
  speed?: string
  ytDlpCommand?: string
  // Enhanced video information
  duration?: number
  fileSize?: number
  savedFileName?: string
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
  origin?: 'manual' | 'subscription'
  subscriptionId?: string
  // Download-specific format info
  selectedFormat?: VideoFormat
  // Playlist context (optional)
  playlistId?: string
  playlistTitle?: string
  playlistIndex?: number
  playlistSize?: number
}

export interface SubscriptionFeedItem {
  id: string
  url: string
  title: string
  publishedAt: number
  thumbnail?: string
  addedToQueue: boolean
  downloadId?: string
}

export interface DownloadHistoryItem {
  id: string
  url: string
  title: string
  thumbnail?: string
  type: 'video' | 'audio'
  status: DownloadStatus
  downloadPath?: string
  savedFileName?: string
  fileSize?: number
  duration?: number
  downloadedAt: number
  completedAt?: number
  error?: string
  ytDlpCommand?: string
  // Additional metadata
  description?: string
  channel?: string
  uploader?: string
  viewCount?: number
  tags?: string[]
  origin?: 'manual' | 'subscription'
  subscriptionId?: string
  // Download-specific format info
  selectedFormat?: VideoFormat
  // Playlist context (optional)
  playlistId?: string
  playlistTitle?: string
  playlistIndex?: number
  playlistSize?: number
}

export interface DownloadOptions {
  url: string
  type: 'video' | 'audio'
  format?: string
  audioFormat?: string
  audioFormatIds?: string[]
  startTime?: string
  endTime?: string
  downloadSubs?: boolean
  customDownloadPath?: string
  customFilenameTemplate?: string
  tags?: string[]
  origin?: 'manual' | 'subscription'
  subscriptionId?: string
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

export interface PlaylistDownloadOptions {
  url: string
  type: 'video' | 'audio'
  format?: string
  startIndex?: number
  endIndex?: number
  filenameFormat?: string
  folderFormat?: string
  customDownloadPath?: string
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
  type: 'video' | 'audio'
  totalCount: number
  startIndex: number
  endIndex: number
  entries: PlaylistDownloadEntry[]
}

// Subscription types
export type SubscriptionPlatform = 'youtube' | 'bilibili' | 'custom'

export type SubscriptionStatus = 'idle' | 'checking' | 'up-to-date' | 'failed'

export const SUBSCRIPTION_DUPLICATE_FEED_ERROR = 'SUBSCRIPTION_DUPLICATE_FEED_URL'

export interface SubscriptionRule {
  id: string
  title: string
  sourceUrl: string
  feedUrl: string
  platform: SubscriptionPlatform
  keywords: string[]
  tags: string[]
  onlyDownloadLatest: boolean
  enabled: boolean
  coverUrl?: string
  latestVideoTitle?: string
  latestVideoPublishedAt?: number
  lastCheckedAt?: number
  lastSuccessAt?: number
  status: SubscriptionStatus
  lastError?: string
  createdAt: number
  updatedAt: number
  downloadDirectory?: string
  namingTemplate?: string
  items: SubscriptionFeedItem[]
}

export interface SubscriptionResolvedFeed {
  sourceUrl: string
  feedUrl: string
  platform: SubscriptionPlatform
}

export interface SubscriptionCreatePayload {
  sourceUrl: string
  feedUrl: string
  platform: SubscriptionPlatform
  keywords?: string[]
  tags?: string[]
  onlyDownloadLatest?: boolean
  downloadDirectory?: string
  namingTemplate?: string
  enabled?: boolean
}

export interface SubscriptionUpdatePayload {
  title?: string
  sourceUrl?: string
  feedUrl?: string
  platform?: SubscriptionPlatform
  keywords?: string[]
  tags?: string[]
  onlyDownloadLatest?: boolean
  enabled?: boolean
  downloadDirectory?: string
  namingTemplate?: string
  items?: SubscriptionFeedItem[]
}

// Settings types
export type OneClickQualityPreset = 'best' | 'good' | 'normal' | 'bad' | 'worst'

export interface AppSettings {
  downloadPath: string
  maxConcurrentDownloads: number
  browserForCookies: string
  cookiesPath: string
  proxy: string
  configPath: string
  betaProgram: boolean
  language: LanguageCode
  theme: string
  oneClickDownload: boolean
  oneClickDownloadType: 'video' | 'audio'
  oneClickQuality: OneClickQualityPreset
  closeToTray: boolean
  hideDockIcon: boolean
  launchAtLogin: boolean
  autoUpdate: boolean
  subscriptionOnlyLatestDefault: boolean
  enableAnalytics: boolean
  embedSubs: boolean
  embedThumbnail: boolean
  embedMetadata: boolean
  embedChapters: boolean
}

export const DEFAULT_SUBSCRIPTION_FILENAME_TEMPLATE = '%(uploader)s/%(title)s.%(ext)s'

export const defaultSettings: AppSettings = {
  downloadPath: '',
  maxConcurrentDownloads: 5,
  browserForCookies: 'none',
  cookiesPath: '',
  proxy: '',
  configPath: '',
  betaProgram: false,
  language: defaultLanguageCode,
  theme: 'system',
  oneClickDownload: false,
  oneClickDownloadType: 'video',
  oneClickQuality: 'best',
  closeToTray: true,
  hideDockIcon: false,
  launchAtLogin: false,
  autoUpdate: true,
  subscriptionOnlyLatestDefault: true,
  enableAnalytics: true,
  embedSubs: true,
  embedThumbnail: false,
  embedMetadata: true,
  embedChapters: true
}
