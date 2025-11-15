import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import log from 'electron-log/main'
import Parser from 'rss-parser'
import type { SubscriptionFeedItem, SubscriptionRule } from '../../shared/types'
import { settingsManager } from '../settings'
import { downloadEngine } from './download-engine'
import { historyManager } from './history-manager'
import { subscriptionManager } from './subscription-manager'

const logger = log.scope('subscriptions')

type ParserItem = {
  title?: string
  link?: string
  guid?: string
  id?: string
  isoDate?: string
  pubDate?: string
  youtubeId?: string
  mediaThumbnail?: Array<{ url?: string }> | { url?: string }
  mediaContent?: Array<{ url?: string }> | { url?: string }
  enclosure?: Array<{ url?: string; type?: string }> | { url?: string; type?: string }
  [key: string]: unknown
}

type TrackedDownload = {
  subscriptionId: string
  itemId: string
  url: string
  retries: number
  downloadId: string
}

type FeedItem = {
  id: string
  url: string
  title: string
  publishedAt: number
  thumbnail?: string
}

const parser = new Parser<{ item: ParserItem }>({
  customFields: {
    item: [
      ['yt:videoId', 'youtubeId'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['media:content', 'mediaContent'],
      ['enclosure', 'enclosure']
    ]
  }
})

const clampIntervalHours = (value: number | undefined): number => {
  if (!value || Number.isNaN(value)) {
    return 3
  }
  return Math.min(24, Math.max(1, value))
}

const sanitizeDownloadId = (subscriptionId: string, itemId: string): string => {
  const base = Buffer.from(`${subscriptionId}:${itemId}`).toString('base64url')
  return `sub_${base}`
}

const ensureDirectoryExists = (dir?: string): void => {
  if (!dir) {
    return
  }
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (error) {
    logger.warn('Failed to ensure subscription download directory:', error)
  }
}

export class SubscriptionScheduler extends EventEmitter {
  private timer?: NodeJS.Timeout
  private checking = false
  private pendingRun = false
  private downloads: Map<string, TrackedDownload> = new Map()

  constructor() {
    super()
    downloadEngine.on('download-completed', (id: string) => {
      const tracked = this.downloads.get(id)
      if (!tracked) {
        return
      }
      this.downloads.delete(id)
      subscriptionManager.update(tracked.subscriptionId, {
        status: 'up-to-date',
        lastSuccessAt: Date.now()
      })
      subscriptionManager.updateFeedItemQueueState(tracked.subscriptionId, tracked.itemId, {
        downloadId: id
      })
    })

    downloadEngine.on('download-error', (id: string, error: Error) => {
      const tracked = this.downloads.get(id)
      if (!tracked) {
        return
      }
      const currentRetries = tracked.retries ?? 0
      if (currentRetries < 1) {
        logger.warn('Retrying failed subscription download', { id, error })
        this.queueDownload(
          tracked.subscriptionId,
          tracked.itemId,
          tracked.url,
          currentRetries + 1
        ).catch((queueError) => {
          logger.error('Retry queue failed:', queueError)
        })
        return
      }

      this.downloads.delete(id)
      subscriptionManager.update(tracked.subscriptionId, {
        status: 'failed',
        lastCheckedAt: Date.now()
      })
      subscriptionManager.updateFeedItemQueueState(tracked.subscriptionId, tracked.itemId, {
        downloadId: null
      })
    })
  }

  start(): void {
    this.scheduleNextRun(0)
  }

  refreshInterval(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.scheduleNextRun()
  }

  async runNow(subscriptionId?: string): Promise<void> {
    if (subscriptionId) {
      const target = subscriptionManager.getById(subscriptionId)
      if (target?.enabled) {
        await this.checkSubscription(target)
      }
      return
    }
    await this.checkAll()
  }

  async queueItem(subscriptionId: string, itemId: string): Promise<boolean> {
    const subscription = subscriptionManager.getById(subscriptionId)
    if (!subscription) {
      return false
    }
    const item = subscription.items.find((entry) => entry.id === itemId)
    if (!item || item.addedToQueue) {
      return false
    }
    await this.queueDownload(subscriptionId, itemId, item.url)
    return true
  }

  private scheduleNextRun(initialDelay?: number): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    const intervalHours = clampIntervalHours(settingsManager.get('subscriptionCheckIntervalHours'))
    const delayMs = initialDelay ?? intervalHours * 60 * 60 * 1000
    this.timer = setTimeout(() => {
      void this.checkAll().finally(() => this.scheduleNextRun())
    }, delayMs)
  }

  private async checkAll(): Promise<void> {
    if (this.checking) {
      this.pendingRun = true
      return
    }
    this.checking = true
    try {
      const subscriptions = subscriptionManager
        .getAll()
        .filter((subscription) => subscription.enabled)
      for (const subscription of subscriptions) {
        await this.checkSubscription(subscription)
      }
    } catch (error) {
      logger.error('Failed to run subscription sync', error)
    } finally {
      this.checking = false
      if (this.pendingRun) {
        this.pendingRun = false
        void this.checkAll()
      }
    }
  }

  private async checkSubscription(subscription: SubscriptionRule): Promise<void> {
    const startedAt = Date.now()
    subscriptionManager.update(subscription.id, {
      status: 'checking',
      lastCheckedAt: startedAt,
      lastError: undefined
    })

    try {
      const feed = await parser.parseURL(subscription.feedUrl)
      const feedItems = Array.isArray(feed.items) ? feed.items : []
      const normalizedItems = this.normalizeFeedItems(feedItems as ParserItem[])
      const recentItems = this.filterRecentItems(subscription, normalizedItems)
      const unseenItems = this.filterNewItems(subscription, recentItems)
      const keywords = subscription.keywords.map((keyword) => keyword.toLowerCase())
      const keywordFiltered =
        keywords.length > 0
          ? unseenItems.filter((item) => {
              const lowered = item.title.toLowerCase()
              return keywords.some((keyword) => lowered.includes(keyword))
            })
          : unseenItems

      const deduped = keywordFiltered
        .filter((item) => !historyManager.hasHistoryForUrl(item.url))
        .sort((a, b) => b.publishedAt - a.publishedAt)

      const itemsToDownload =
        subscription.onlyDownloadLatest && deduped.length > 0 ? [deduped[0]] : deduped

      subscriptionManager.replaceFeedItems(
        subscription.id,
        this.buildFeedItems(normalizedItems, subscription)
      )

      if (itemsToDownload.length > 0) {
        for (const item of itemsToDownload) {
          await this.queueDownload(subscription.id, item.id, item.url)
        }
      }

      const latestItem = normalizedItems[0]
      subscriptionManager.update(subscription.id, {
        status: 'up-to-date',
        lastSuccessAt: Date.now(),
        lastError: undefined,
        latestVideoTitle: latestItem?.title ?? subscription.latestVideoTitle,
        latestVideoPublishedAt: latestItem?.publishedAt ?? subscription.latestVideoPublishedAt,
        coverUrl: (feed.image as { url?: string } | undefined)?.url ?? subscription.coverUrl,
        title:
          typeof feed.title === 'string' && feed.title.trim().length > 0
            ? feed.title.trim()
            : subscription.title,
        sourceUrl:
          typeof feed.link === 'string' && feed.link.trim().length > 0
            ? feed.link.trim()
            : subscription.sourceUrl
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown RSS error'
      subscriptionManager.update(subscription.id, {
        status: 'failed',
        lastError: message,
        lastCheckedAt: Date.now()
      })
      logger.error('Subscription check failed:', { id: subscription.id, error })
    }
  }

  private normalizeFeedItems(items: ParserItem[]): FeedItem[] {
    const normalized: FeedItem[] = []
    for (const item of items) {
      const id = this.resolveItemId(item)
      if (!id || !item.link || !item.title) {
        continue
      }
      normalized.push({
        id,
        url: item.link,
        title: item.title,
        publishedAt: this.resolvePublishedAt(item),
        thumbnail: this.resolveThumbnail(item)
      })
    }

    return normalized.sort((a, b) => b.publishedAt - a.publishedAt)
  }

  private buildFeedItems(
    items: FeedItem[],
    subscription: SubscriptionRule
  ): SubscriptionFeedItem[] {
    const existingItems = new Map(subscription.items.map((item) => [item.id, item]))
    return items.map((item) => {
      const tracked = this.getTrackedDownloadByUrl(item.url)
      const existing = existingItems.get(item.id)
      return {
        id: item.id,
        url: item.url,
        title: item.title,
        publishedAt: item.publishedAt,
        thumbnail: item.thumbnail,
        addedToQueue:
          Boolean(tracked) || existing?.addedToQueue || historyManager.hasHistoryForUrl(item.url),
        downloadId: tracked?.downloadId ?? existing?.downloadId
      }
    })
  }

  private resolveItemId(item: ParserItem): string | null {
    const idCandidate =
      item.youtubeId || item.guid || item.id || (typeof item.link === 'string' ? item.link : null)
    if (!idCandidate) {
      return null
    }
    return idCandidate.trim()
  }

  private resolvePublishedAt(item: ParserItem): number {
    const candidates = [item.isoDate, item.pubDate]
    for (const candidate of candidates) {
      if (!candidate) {
        continue
      }
      const timestamp = Date.parse(candidate)
      if (!Number.isNaN(timestamp)) {
        return timestamp
      }
    }
    return Date.now()
  }

  private resolveThumbnail(item: ParserItem): string | undefined {
    // Try media:thumbnail first
    const thumbnail = item.mediaThumbnail
    if (Array.isArray(thumbnail)) {
      const found = thumbnail.find((entry) => entry?.url)
      if (found?.url) return found.url
    }
    if (thumbnail && typeof thumbnail === 'object' && 'url' in thumbnail) {
      return thumbnail.url as string | undefined
    }

    // Try enclosure (for RSS feeds with image/jpeg type)
    const enclosure = item.enclosure
    if (Array.isArray(enclosure)) {
      const imageEnclosure = enclosure.find(
        (entry) => entry?.url && entry?.type?.startsWith('image/')
      )
      if (imageEnclosure?.url) return imageEnclosure.url
    }
    if (enclosure && typeof enclosure === 'object' && 'url' in enclosure) {
      const enc = enclosure as { url?: string; type?: string }
      if (enc.url && enc.type?.startsWith('image/')) {
        return enc.url
      }
    }

    // Try media:content as fallback
    const mediaContent = item.mediaContent
    if (Array.isArray(mediaContent)) {
      const found = mediaContent.find((entry) => entry?.url)
      if (found?.url) return found.url
    }
    if (mediaContent && typeof mediaContent === 'object' && 'url' in mediaContent) {
      return mediaContent.url as string | undefined
    }

    return undefined
  }

  private filterRecentItems(subscription: SubscriptionRule, items: FeedItem[]): FeedItem[] {
    const lastKnownPublishedAt = this.getLastKnownPublishedAt(subscription)
    if (lastKnownPublishedAt === 0) {
      return subscription.onlyDownloadLatest ? items.slice(0, 1) : items
    }
    return items.filter((item) => item.publishedAt > lastKnownPublishedAt)
  }

  private getLastKnownPublishedAt(subscription: SubscriptionRule): number {
    const fromItems = subscription.items.reduce((max, item) => Math.max(max, item.publishedAt), 0)
    return Math.max(subscription.latestVideoPublishedAt ?? 0, fromItems)
  }

  private filterNewItems(subscription: SubscriptionRule, items: FeedItem[]): FeedItem[] {
    const seenIds = new Set(subscription.items.map((item) => item.id))
    return items.filter((item) => !seenIds.has(item.id))
  }

  private async queueDownload(
    subscriptionId: string,
    itemId: string,
    url: string,
    retryCount = 0
  ): Promise<void> {
    const downloadId = sanitizeDownloadId(subscriptionId, itemId)
    const isRetry = retryCount > 0
    if (this.downloads.has(downloadId) && !isRetry) {
      return
    }

    const subscription = subscriptionManager.getById(subscriptionId)
    if (!subscription) {
      return
    }

    const settings = settingsManager.getAll()
    const downloadDirectory = subscription.downloadDirectory?.trim() || settings.downloadPath
    const namingTemplate =
      subscription.namingTemplate?.trim() || settings.subscriptionFilenameTemplate
    ensureDirectoryExists(downloadDirectory)

    const tags = Array.from(new Set([subscription.platform, ...subscription.tags]))

    try {
      downloadEngine.startDownload(downloadId, {
        url,
        type: 'video',
        customDownloadPath: downloadDirectory,
        customFilenameTemplate: namingTemplate,
        tags,
        origin: 'subscription',
        subscriptionId
      })

      this.downloads.set(downloadId, {
        subscriptionId,
        itemId,
        url,
        retries: retryCount,
        downloadId
      })
      subscriptionManager.updateFeedItemQueueState(subscriptionId, itemId, {
        added: true,
        downloadId
      })
    } catch (error) {
      logger.error('Failed to start subscription download', { subscriptionId, itemId, error })
      subscriptionManager.update(subscriptionId, {
        status: 'failed'
      })
      subscriptionManager.updateFeedItemQueueState(subscriptionId, itemId, {
        added: false,
        downloadId: null
      })
    }
  }

  private getTrackedDownloadByUrl(url: string): TrackedDownload | undefined {
    for (const tracked of this.downloads.values()) {
      if (tracked.url === url) {
        return tracked
      }
    }
    return undefined
  }
}

export const subscriptionScheduler = new SubscriptionScheduler()
