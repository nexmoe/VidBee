import type { OneClickContainerOption } from '@vidbee/downloader-core/format-preferences'
import { defaultLanguageCode, type LanguageCode } from '@vidbee/i18n/languages'

export type { OneClickContainerOption }

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
  | 'paused'

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
  ytDlpLog?: string
  glitchTipEventId?: string
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
  /**
   * yt-dlp's resolved format id (e.g. `30080+30280`). Differs from
   * `selectedFormat.format_id` when the chain fell back to best-available;
   * the row uses this to render a "fell back" hint.
   */
  resolvedFormatId?: string
  // Playlist context (optional)
  playlistId?: string
  playlistTitle?: string
  playlistIndex?: number
  playlistSize?: number
  // NEX-131 §10.A.5 projection passthrough fields. Optional so renderer
  // components that haven't opted in keep working unchanged. internalStatus
  // is the underlying 8-state TaskStatus; subStatus carries 'paused' or
  // 'retry-scheduled' (mapped onto pending in the legacy enum); statusReason
  // distinguishes 'crash-recovery' / 'user' / etc.
  internalStatus?: string
  subStatus?: string
  statusReason?: string | null
  nextRetryAt?: number | null
  attempt?: number
  maxAttempts?: number
  errorCategory?: string
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
  resolvedFormatId?: string
  fileSize?: number
  duration?: number
  downloadedAt: number
  completedAt?: number
  error?: string
  ytDlpCommand?: string
  ytDlpLog?: string
  glitchTipEventId?: string
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
  containerFormat?: OneClickContainerOption
  tags?: string[]
  origin?: 'manual' | 'subscription'
  subscriptionId?: string
  /**
   * Pre-fetched videoInfo metadata so the renderer's optimistic row
   * survives the kernel's snapshot-changed → download:updated round-trip.
   * Without these, the projection re-derives `title` from the URL and
   * `thumbnail`/`description`/etc. arrive as undefined, which spreads
   * over the optimistic row and wipes its metadata on the first tick.
   */
  title?: string
  thumbnail?: string
  description?: string
  channel?: string
  uploader?: string
  viewCount?: number
  duration?: number
  selectedFormat?: VideoFormat
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
  entryIds?: string[]
  startIndex?: number
  endIndex?: number
  filenameFormat?: string
  folderFormat?: string
  customDownloadPath?: string
  containerFormat?: OneClickContainerOption
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
  downloadWithoutChannelSubfolders: boolean
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
  oneClickContainer: OneClickContainerOption
  closeToTray: boolean
  hideDockIcon: boolean
  launchAtLogin: boolean
  autoUpdate: boolean
  subscriptionOnlyLatestDefault: boolean
  enableAnalytics: boolean
  enableDownloadNotifications: boolean
  rememberLastAudioLanguage: boolean
  preferredAudioLanguage: string
  embedSubs: boolean
  embedThumbnail: boolean
  embedMetadata: boolean
  embedChapters: boolean
  shareWatermark: boolean
}

export const DEFAULT_SUBSCRIPTION_FILENAME_TEMPLATE = '%(uploader)s/%(title)s.%(ext)s'

export const defaultSettings: AppSettings = {
  downloadPath: '',
  maxConcurrentDownloads: 5,
  downloadWithoutChannelSubfolders: false,
  browserForCookies: 'none',
  cookiesPath: '',
  proxy: '',
  configPath: '',
  betaProgram: false,
  language: defaultLanguageCode,
  theme: 'system',
  oneClickDownload: true,
  oneClickDownloadType: 'video',
  oneClickQuality: 'best',
  oneClickContainer: 'auto',
  closeToTray: true,
  hideDockIcon: false,
  launchAtLogin: false,
  autoUpdate: true,
  subscriptionOnlyLatestDefault: true,
  enableAnalytics: true,
  enableDownloadNotifications: true,
  rememberLastAudioLanguage: true,
  preferredAudioLanguage: '',
  embedSubs: true,
  embedThumbnail: false,
  embedMetadata: true,
  embedChapters: true,
  shareWatermark: false
}
