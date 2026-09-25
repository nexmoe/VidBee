/**
 * Canonical domain model for @vidbee/subscriptions-core.
 *
 * Authoritative spec: NEX-132 issue body (`Phase A · packages/subscriptions-core`)
 * and `docs/vidbee-desktop-first-cli-ytdlp-rss-design.md` §7.
 *
 * Adapters in apps/desktop, apps/api and apps/cli MUST consume these types
 * directly; any host-local divergence is a contract bug.
 */

export type SubscriptionPlatform = 'youtube' | 'bilibili' | 'custom'

/**
 * High-level subscription state. The granular task lifecycle for a
 * subscription item is owned by `@vidbee/task-queue` (see `TaskStatus`); this
 * field describes only the result of the most recent feed-check, not
 * individual items.
 */
export type SubscriptionStatus = 'idle' | 'checking' | 'up-to-date' | 'failed'

/** Returned by `feed-resolver` from a raw user-entered URL. */
export interface ResolvedFeed {
  sourceUrl: string
  feedUrl: string
  platform: SubscriptionPlatform
}

export interface SubscriptionRule {
  id: string
  title: string
  sourceUrl: string
  feedUrl: string
  platform: SubscriptionPlatform
  keywords: string[]
  tags: string[]
  onlyDownloadLatest: boolean
  /** When false, feed items are listed but not queued automatically. */
  autoDownload: boolean
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
}

export interface SubscriptionFeedItem {
  /** Stable id within a subscription (yt:videoId / guid / link). */
  id: string
  url: string
  title: string
  publishedAt: number
  thumbnail?: string
  /**
   * True while this item is linked to a task that still exists.
   * The row itself is the already-seen history: clearing this flag allows a
   * manual re-add and does not make the next feed check download it again.
   */
  addedToQueue: boolean
  /** Task id while the item is queued. Cleared when that task is removed. */
  taskId?: string
}

export interface SubscriptionWithItems extends SubscriptionRule {
  items: SubscriptionFeedItem[]
}

export interface SubscriptionCreateInput {
  sourceUrl: string
  feedUrl: string
  platform: SubscriptionPlatform
  title?: string
  keywords?: string[]
  tags?: string[]
  onlyDownloadLatest?: boolean
  autoDownload?: boolean
  downloadDirectory?: string
  namingTemplate?: string
  enabled?: boolean
}

export interface SubscriptionUpdateInput {
  title?: string
  sourceUrl?: string
  feedUrl?: string
  platform?: SubscriptionPlatform
  keywords?: string[]
  tags?: string[]
  onlyDownloadLatest?: boolean
  autoDownload?: boolean
  enabled?: boolean
  downloadDirectory?: string
  namingTemplate?: string
}

/** Raw RSS-parser item shape we read into. Hosts may pass extras. */
export interface ParsedFeedItem {
  title?: string
  link?: string
  guid?: string
  id?: string
  isoDate?: string
  pubDate?: string
  youtubeId?: string
  content?: string
  contentSnippet?: string
  contentEncoded?: string
  summary?: string
  description?: string
  mediaThumbnail?: Array<{ url?: string }> | { url?: string }
  mediaContent?: Array<{ url?: string }> | { url?: string }
  enclosure?: Array<{ url?: string; type?: string }> | { url?: string; type?: string }
  /** Podcast episode artwork (`itunes:image` href or nested `{ href }` / `{ url }`). */
  itunes?: { image?: string | { href?: string; url?: string } }
  [key: string]: unknown
}

export interface ParsedFeed {
  title?: string
  link?: string
  image?: { url?: string }
  itunes?: { image?: string }
  items: ParsedFeedItem[]
}

export interface NormalizedFeedItem {
  id: string
  url: string
  title: string
  publishedAt: number
  thumbnail?: string
}

/** Identity of the host competing for the feed-check leader role. */
export type LeaderKind = 'desktop' | 'api'

export interface LeaderState {
  kind: LeaderKind | null
  pid: number | null
  startedAt: number | null
  heartbeatAt: number | null
  lockExpiresAt: number | null
  /** Random per acquisition; the lease holder uses this as a CAS guard. */
  leaseId: string | null
  /** Operator override. */
  preferred: LeaderKind | null
}

export interface LeaderAcquireOptions {
  kind: LeaderKind
  pid: number
  /** Defaults to 30_000ms. */
  heartbeatIntervalMs?: number
  /** Defaults to 90_000ms. */
  lockTtlMs?: number
  now?: () => number
}

export const DEFAULT_LEADER_HEARTBEAT_MS = 30_000
export const DEFAULT_LEADER_LOCK_TTL_MS = 90_000
export const DEFAULT_FEED_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1_000 // 3h
export const DEFAULT_REFRESH_DEDUPE_WINDOW_MS = 30_000
export const DEFAULT_SUBSCRIPTION_FILENAME_TEMPLATE = '%(uploader)s/%(title)s.%(ext)s'
export const SUBSCRIPTION_DUPLICATE_FEED_ERROR = 'SUBSCRIPTION_DUPLICATE_FEED_URL'

/**
 * Decision returned by the auto-download policy. Hosts feed each item to the
 * task queue with `priority = 10` and `groupKey = subscription.id`. The
 * decision itself is host-neutral; how the host actually enqueues is its job.
 */
export interface AutoDownloadDecision {
  subscription: SubscriptionRule
  items: NormalizedFeedItem[]
  /**
   * The full normalized feed, used to refresh the on-disk
   * `subscription_items` snapshot independently of which items are queued.
   */
  feedItemsToPersist: NormalizedFeedItem[]
  /** Most recent published-at across the normalized feed. */
  latestPublishedAt: number | null
  /** Title of the newest feed item, or undefined when the feed is empty. */
  latestVideoTitle?: string
  /** Resolved cover URL (feed image / itunes / first thumbnail). */
  coverUrl?: string
}
