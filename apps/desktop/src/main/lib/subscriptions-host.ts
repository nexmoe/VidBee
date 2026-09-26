/**
 * Desktop host for @vidbee/subscriptions-core (NEX-132 Phase B · Desktop).
 *
 * Owns the single `SubscriptionsApi` the IPC `SubscriptionService` and the
 * loopback automation surface forward into. Bridges subscription items into
 * the shared task-queue (priority 10, group-keyed by subscription id).
 *
 * Storage: the existing desktop SQLite database (vidbee.db). The subscriptions
 * tables already exist from the legacy schema; on first boot of the new
 * stack we run a tiny migration to:
 *
 *   1. rename `subscription_items.download_id` → `task_id` (the new column
 *      points at task-queue.tasks rows instead of legacy download-engine ids),
 *   2. create the `subscriptions_meta` table that backs leader election.
 *
 * Both steps are idempotent and CREATE TABLE IF NOT EXISTS-style so they're
 * safe to re-run on every boot. We now read everything through the shared
 * `@vidbee/db/subscriptions` Drizzle schema; the legacy
 * `subscription-manager.ts` / `subscription-scheduler.ts` modules they
 * superseded have been removed.
 */
import { applySubscriptionsMigrations } from '@vidbee/db/subscriptions'
import {
  createSqliteMetaStore,
  createSqliteSubscriptionsStore,
  RssParserFeedFetcher,
  SubscriptionsApi,
  type SubscriptionWithItems
} from '@vidbee/subscriptions-core'
import type { SubscriptionFeedItem, SubscriptionRule } from '../../shared/types'
import { settingsManager } from '../settings'
import { scopedLoggers } from '../utils/logger'
import { getDatabaseConnection } from './database'
import { historyManager } from './history-manager'
import { buildDesktopSubscriptionTaskInput } from './subscription-enqueue'
import { getDesktopTaskQueue } from './task-queue-host'

const logger = scopedLoggers.engine

/**
 * Apply subscription DDL on top of the existing desktop SQLite. Renames
 * `download_id` → `task_id` once, adds `subscriptions_meta`, and additive
 * columns such as `auto_download`. Idempotent.
 */
const ensureSubscriptionsSchema = (): void => {
  const { sqlite } = getDatabaseConnection()
  // Rename the legacy column once. SQLite supports RENAME COLUMN since
  // 3.25 (2018). Detect via PRAGMA so we don't trip on subsequent boots.
  const cols = sqlite.prepare('PRAGMA table_info(subscription_items)').all() as Array<{
    name?: string
  }>
  const colNames = new Set(cols.map((c) => c.name).filter(Boolean) as string[])
  if (colNames.has('download_id') && !colNames.has('task_id')) {
    sqlite.exec('ALTER TABLE subscription_items RENAME COLUMN download_id TO task_id')
    logger.info('subscriptions: migrated download_id → task_id on subscription_items')
  }
  const subscriptionCols = sqlite.prepare('PRAGMA table_info(subscriptions)').all() as Array<{
    name?: string
  }>
  const subscriptionColNames = subscriptionCols.map((c) => c.name).filter(Boolean) as string[]
  // CREATE TABLE IF NOT EXISTS for `subscriptions_meta` and indexes; existing
  // `subscriptions` / `subscription_items` are no-op'd by IF NOT EXISTS.
  // V2 adds `auto_download` for databases created before that column existed.
  applySubscriptionsMigrations((sql) => sqlite.exec(sql), subscriptionColNames)
}

const ensureDirectoryExists = (dir?: string): void => {
  if (!dir) {
    return
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    logger.warn('subscriptions: failed to ensure subscription download directory', err)
  }
}

let api: SubscriptionsApi | null = null
let started = false
let removeTaskListener: (() => void) | null = null

export const getDesktopSubscriptions = (): SubscriptionsApi => {
  if (api) {
    return api
  }
  ensureSubscriptionsSchema()
  const { db } = getDatabaseConnection()
  const store = createSqliteSubscriptionsStore({ db })
  const metaStore = createSqliteMetaStore({ db })

  api = new SubscriptionsApi({
    kind: 'desktop',
    pid: process.pid,
    store,
    metaStore,
    fetcher: new RssParserFeedFetcher(),
    isHistoryDup: (url) => historyManager.hasHistoryForUrl(url),
    // `get` is this process's startup snapshot. A task the API wrote to the
    // shared database after that is still a real download.
    taskExists: (taskId) => getDesktopTaskQueue().hasTask(taskId),
    enqueueItem: async ({ subscription, item, trigger, creation }) => {
      const { task, downloadDirectory } = buildDesktopSubscriptionTaskInput({
        settings: settingsManager.getAll(),
        subscription,
        item,
        trigger,
        creation
      })
      ensureDirectoryExists(downloadDirectory)
      const result = await getDesktopTaskQueue().add({
        input: task,
        priority: 10,
        groupKey: subscription.id
      })
      return result.id
    },
    log: (level, msg, meta) => {
      const line = meta === undefined ? msg : `${msg} ${JSON.stringify(meta)}`
      if (level === 'error') {
        logger.error(`subscriptions: ${line}`)
      } else if (level === 'warn') {
        logger.warn(`subscriptions: ${line}`)
      } else {
        logger.info(`subscriptions: ${line}`)
      }
    }
  })
  return api
}

export const startDesktopSubscriptions = async (): Promise<void> => {
  if (started) {
    return
  }
  const subscriptions = getDesktopSubscriptions()
  await subscriptions.start()
  removeTaskListener = getDesktopTaskQueue().on('task-removed', (event) => {
    subscriptions.noteTaskRemoved(event.taskId)
  })
  started = true
}

export const stopDesktopSubscriptions = async (): Promise<void> => {
  if (!started) {
    return
  }
  removeTaskListener?.()
  removeTaskListener = null
  await api?.stop()
  started = false
}

/**
 * Remove a subscription and cancel any non-terminal tasks the queue still
 * holds for it. See NEX-132 regression checklist: "用户暂停 / 删除订阅后，
 * 已经入队但未开始的 subscription-item 任务被自动取消".
 */
export const removeDesktopSubscription = async (id: string): Promise<void> => {
  await getDesktopSubscriptions().remove({ id })
  const queue = getDesktopTaskQueue()
  let cursor: string | null = null
  do {
    const page = queue.list({ groupKey: id, limit: 200, cursor })
    for (const task of page.tasks) {
      if (
        task.status === 'queued' ||
        task.status === 'running' ||
        task.status === 'processing' ||
        task.status === 'paused' ||
        task.status === 'retry-scheduled'
      ) {
        try {
          await queue.cancel(task.id)
        } catch {
          // Best-effort: ignore tasks that already moved to a terminal state.
        }
      }
    }
    cursor = page.nextCursor
  } while (cursor)
}

/**
 * Project the new `SubscriptionWithItems` shape into the legacy renderer
 * `SubscriptionRule`. The only on-the-wire difference is `taskId` ↔
 * `downloadId`; the renderer still uses `downloadId` to correlate live
 * download state, so we forward the new task-queue id under the legacy
 * field name. Other optional fields are conditionally copied so the wire
 * shape matches what `subscriptionManager.getAll()` previously returned.
 */
export const projectSubscriptionForRenderer = (sub: SubscriptionWithItems): SubscriptionRule => {
  const items: SubscriptionFeedItem[] = sub.items.map((item) => {
    const projected: SubscriptionFeedItem = {
      id: item.id,
      url: item.url,
      title: item.title,
      publishedAt: item.publishedAt,
      addedToQueue: item.addedToQueue
    }
    if (item.thumbnail !== undefined) {
      projected.thumbnail = item.thumbnail
    }
    if (item.taskId !== undefined) {
      projected.downloadId = item.taskId
    }
    return projected
  })
  const projected: SubscriptionRule = {
    id: sub.id,
    title: sub.title,
    sourceUrl: sub.sourceUrl,
    feedUrl: sub.feedUrl,
    platform: sub.platform,
    keywords: sub.keywords,
    tags: sub.tags,
    onlyDownloadLatest: sub.onlyDownloadLatest,
    autoDownload: sub.autoDownload,
    enabled: sub.enabled,
    status: sub.status,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
    items
  }
  if (sub.coverUrl !== undefined) {
    projected.coverUrl = sub.coverUrl
  }
  if (sub.latestVideoTitle !== undefined) {
    projected.latestVideoTitle = sub.latestVideoTitle
  }
  if (sub.latestVideoPublishedAt !== undefined) {
    projected.latestVideoPublishedAt = sub.latestVideoPublishedAt
  }
  if (sub.lastCheckedAt !== undefined) {
    projected.lastCheckedAt = sub.lastCheckedAt
  }
  if (sub.lastSuccessAt !== undefined) {
    projected.lastSuccessAt = sub.lastSuccessAt
  }
  if (sub.lastError !== undefined) {
    projected.lastError = sub.lastError
  }
  if (sub.downloadDirectory !== undefined) {
    projected.downloadDirectory = sub.downloadDirectory
  }
  if (sub.namingTemplate !== undefined) {
    projected.namingTemplate = sub.namingTemplate
  }
  return projected
}

/**
 * Re-fetch the full list and project to the renderer-facing shape. Hosts
 * call this from the `subscriptions:updated` broadcast so the renderer
 * always sees a consistent snapshot.
 */
export const listDesktopSubscriptionsSnapshot = async (): Promise<SubscriptionRule[]> => {
  const { items } = await getDesktopSubscriptions().list()
  return items.map(projectSubscriptionForRenderer)
}
