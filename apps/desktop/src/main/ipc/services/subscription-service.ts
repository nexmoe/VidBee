import path from 'node:path'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type {
  SubscriptionCreatePayload,
  SubscriptionResolvedFeed,
  SubscriptionRule,
  SubscriptionUpdatePayload
} from '../../../shared/types'
import {
  DEFAULT_SUBSCRIPTION_FILENAME_TEMPLATE,
  SUBSCRIPTION_DUPLICATE_FEED_ERROR
} from '../../../shared/types'
import { sanitizeFilenameTemplate } from '../../download-engine/args-builder'
import { subscriptionManager } from '../../lib/subscription-manager'
import { subscriptionScheduler } from '../../lib/subscription-scheduler'
import { settingsManager } from '../../settings'

interface CreateSubscriptionOptions {
  url: string
  keywords?: string[]
  tags?: string[]
  onlyDownloadLatest?: boolean
  downloadDirectory?: string
  namingTemplate?: string
  enabled?: boolean
}

const ensureUrlHasProtocol = (value: string): string => {
  if (!value) {
    return value
  }
  if (!/^https?:\/\//i.test(value)) {
    return `https://${value}`
  }
  return value
}

const resolveFeedFromInput = (rawUrl: string): SubscriptionResolvedFeed => {
  const normalized = ensureUrlHasProtocol(rawUrl.trim())
  const youTubeChannelMatch = normalized.match(/youtube\.com\/channel\/([A-Za-z0-9_-]+)/i)
  if (youTubeChannelMatch) {
    return {
      sourceUrl: normalized,
      feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${youTubeChannelMatch[1]}`,
      platform: 'youtube'
    }
  }

  if (/youtube\.com\/feeds\/videos\.xml/i.test(normalized)) {
    return {
      sourceUrl: normalized,
      feedUrl: normalized,
      platform: 'youtube'
    }
  }

  const youTubeUserMatch = normalized.match(/youtube\.com\/(?:user|c)\/([^/?]+)/i)
  if (youTubeUserMatch) {
    return {
      sourceUrl: normalized,
      feedUrl: `https://www.youtube.com/feeds/videos.xml?user=${youTubeUserMatch[1]}`,
      platform: 'youtube'
    }
  }

  const youTubeHandleMatch = normalized.match(/youtube\.com\/(@[^/?]+)/i)
  if (youTubeHandleMatch) {
    const handle = youTubeHandleMatch[1].replace('@', '')
    return {
      sourceUrl: normalized,
      feedUrl: `https://www.youtube.com/feeds/videos.xml?user=${handle}`,
      platform: 'youtube'
    }
  }

  const biliSpaceMatch = normalized.match(/bilibili\.com\/(?:space|user)\/(\d+)/i)
  if (biliSpaceMatch) {
    return {
      sourceUrl: normalized,
      feedUrl: `https://rsshub.app/bilibili/user/video/${biliSpaceMatch[1]}`,
      platform: 'bilibili'
    }
  }

  if (/rsshub\.app\/bilibili/i.test(normalized)) {
    return {
      sourceUrl: normalized,
      feedUrl: normalized,
      platform: 'bilibili'
    }
  }

  return {
    sourceUrl: normalized,
    feedUrl: normalized,
    platform: 'custom'
  }
}

class SubscriptionService extends IpcService {
  static readonly groupName = 'subscriptions'

  @IpcMethod()
  list(_context: IpcContext): SubscriptionRule[] {
    return subscriptionManager.getAll()
  }

  @IpcMethod()
  resolve(_context: IpcContext, url: string): SubscriptionResolvedFeed {
    return resolveFeedFromInput(url)
  }

  @IpcMethod()
  async create(
    _context: IpcContext,
    options: CreateSubscriptionOptions
  ): Promise<SubscriptionRule> {
    const resolved = resolveFeedFromInput(options.url)
    const duplicate = subscriptionManager.findDuplicateFeed(resolved.feedUrl)
    if (duplicate) {
      throw new Error(SUBSCRIPTION_DUPLICATE_FEED_ERROR)
    }
    const settings = settingsManager.getAll()
    const defaultDownloadDirectory = path.join(settings.downloadPath, 'Subscriptions')
    const payload: SubscriptionCreatePayload = {
      sourceUrl: resolved.sourceUrl,
      feedUrl: resolved.feedUrl,
      platform: resolved.platform,
      keywords: options.keywords,
      tags: options.tags,
      onlyDownloadLatest:
        options.onlyDownloadLatest ?? settings.subscriptionOnlyLatestDefault ?? true,
      downloadDirectory: options.downloadDirectory || defaultDownloadDirectory,
      namingTemplate: sanitizeFilenameTemplate(
        options.namingTemplate || DEFAULT_SUBSCRIPTION_FILENAME_TEMPLATE
      ),
      enabled: options.enabled ?? true
    }

    const created = subscriptionManager.add(payload)
    void subscriptionScheduler.runNow(created.id)
    return created
  }

  @IpcMethod()
  update(
    _context: IpcContext,
    id: string,
    updates: SubscriptionUpdatePayload
  ): SubscriptionRule | undefined {
    if (updates.feedUrl) {
      const duplicate = subscriptionManager.findDuplicateFeed(updates.feedUrl, id)
      if (duplicate) {
        throw new Error(SUBSCRIPTION_DUPLICATE_FEED_ERROR)
      }
    }
    const normalized: SubscriptionUpdatePayload = { ...updates }
    if (typeof normalized.namingTemplate === 'string') {
      normalized.namingTemplate = sanitizeFilenameTemplate(normalized.namingTemplate)
    }
    return subscriptionManager.update(id, normalized)
  }

  @IpcMethod()
  remove(_context: IpcContext, id: string): boolean {
    return subscriptionManager.remove(id)
  }

  @IpcMethod()
  async refresh(_context: IpcContext, id?: string): Promise<void> {
    await subscriptionScheduler.runNow(id)
  }

  @IpcMethod()
  async queueItem(_context: IpcContext, id: string, itemId: string): Promise<boolean> {
    return subscriptionScheduler.queueItem(id, itemId)
  }
}

export { SubscriptionService }
