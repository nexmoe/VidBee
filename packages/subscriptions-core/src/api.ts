/**
 * Public surface of `@vidbee/subscriptions-core`.
 *
 * Hosts (Desktop main, apps/api server, CLI `--vidbee-local`) instantiate
 * exactly one `SubscriptionsAPI`, point it at:
 *
 *   - a `SubscriptionsStore` (use `createSqliteSubscriptionsStore`),
 *   - a `MetaStore` (use `createSqliteMetaStore`) or `InMemoryMetaStore`,
 *   - a `FeedFetcher` (use `RssParserFeedFetcher` in production),
 *   - an `EnqueueItem` callback that pushes the item into the shared
 *     task-queue,
 *   - and the host's own logger.
 *
 * The class wires up a `LeaderElection` and a `FeedCheckScheduler` and
 * implements every method of the `subscriptionContract`. Hosts mount the
 * contract by binding the API methods 1:1.
 */
import { decideAutoDownloads } from './auto-download'
import { dedupeFeedItems } from './feed-items'
import type { FeedFetcher } from './feed-parser'
import { resolveFeedFromInput } from './feed-resolver'
import { LeaderElection, type LeaderElectionOptions, type MetaStore } from './leader'
import { FeedCheckScheduler, type FeedCheckSchedulerOptions } from './scheduler'
import type { SubscriptionsStore } from './store'
import {
  type AutoDownloadDecision,
  type LeaderKind,
  type LeaderState,
  type NormalizedFeedItem,
  type ResolvedFeed,
  SUBSCRIPTION_DUPLICATE_FEED_ERROR,
  type SubscriptionCreateInput,
  type SubscriptionFeedItem,
  type SubscriptionRule,
  type SubscriptionUpdateInput,
  type SubscriptionWithItems
} from './types'

export interface EnqueueItemContext {
  subscription: SubscriptionRule
  item: NormalizedFeedItem
  /** Why we're enqueuing — 'auto' for scheduled feed-check, 'manual' for user. */
  trigger: 'auto' | 'manual'
}

/**
 * Host-provided callback that pushes the item into the shared task-queue.
 * Returns the spawned task id; null if the host decided to skip (e.g.
 * historic dedupe). Errors propagate.
 */
export type EnqueueItem = (ctx: EnqueueItemContext) => Promise<string | null>

export interface SubscriptionsApiOptions {
  kind: LeaderKind
  pid: number
  store: SubscriptionsStore
  metaStore: MetaStore
  fetcher: FeedFetcher
  enqueueItem: EnqueueItem
  /** Optional: returns true if a URL is already in download history. */
  isHistoryDup?: (url: string) => boolean
  /**
   * Lifted out of `LeaderElectionOptions` for ergonomics; the rest of the
   * leader knobs (heartbeat ms, lock TTL ms, etc.) accept a single options
   * bag. Defaults match the NEX-132 spec.
   */
  leader?: Omit<LeaderElectionOptions, 'metaStore' | 'kind' | 'pid' | 'onStateChange'>
  scheduler?: Omit<FeedCheckSchedulerOptions, 'runAll' | 'runOne' | 'isLeader'>
  log?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
  now?: () => number
}

export { SUBSCRIPTION_DUPLICATE_FEED_ERROR }

export type SubscriptionsApiEvent = 'changed'
export type SubscriptionsApiListener = (kind: SubscriptionsApiEvent) => void

export class SubscriptionsApi {
  private readonly store: SubscriptionsStore
  private readonly fetcher: FeedFetcher
  private readonly enqueueItem: EnqueueItem
  private readonly isHistoryDup: (url: string) => boolean
  private readonly log: NonNullable<SubscriptionsApiOptions['log']>
  private readonly now: () => number
  private readonly election: LeaderElection
  private readonly scheduler: FeedCheckScheduler
  private readonly listeners = new Set<SubscriptionsApiListener>()

  constructor(opts: SubscriptionsApiOptions) {
    this.store = opts.store
    this.fetcher = opts.fetcher
    this.enqueueItem = opts.enqueueItem
    this.isHistoryDup = opts.isHistoryDup ?? (() => false)
    this.log = opts.log ?? (() => undefined)
    this.now = opts.now ?? (() => Date.now())
    this.election = new LeaderElection({
      ...(opts.leader ?? {}),
      metaStore: opts.metaStore,
      kind: opts.kind,
      pid: opts.pid,
      ...(opts.now ? { now: opts.now } : {}),
      log: this.log
    })
    this.scheduler = new FeedCheckScheduler({
      ...(opts.scheduler ?? {}),
      runAll: () => this.refreshAll(),
      runOne: (id) => this.refreshOne(id),
      isLeader: () => this.election.isLeader(),
      log: this.log,
      now: this.now
    })
  }

  /**
   * Register a listener that fires after every state mutation (add / update /
   * remove / refresh / itemsQueue). Hosts use this to push a fresh snapshot
   * to their UI (Desktop's renderer IPC, API's SSE if/when subscription SSE
   * is wired up). Returns an unsubscribe function.
   */
  on(_event: SubscriptionsApiEvent, listener: SubscriptionsApiListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emitChanged(): void {
    for (const listener of this.listeners) {
      try {
        listener('changed')
      } catch (err) {
        // Drop listener errors so one bad subscriber can't break others.
        this.log('warn', 'subscriptions: listener threw', { err })
      }
    }
  }

  // ---------- Lifecycle ----------

  /**
   * Acquire (or steal) the leader lease and start the periodic loop. Calling
   * this on every host is safe; only the winner runs `runAll` on tick.
   */
  async start(): Promise<void> {
    await this.election.tryAcquire()
    this.scheduler.start()
  }

  async stop(): Promise<void> {
    this.scheduler.stop()
    await this.election.release()
  }

  isLeader(): boolean {
    return this.election.isLeader()
  }

  async observeLeader(): Promise<LeaderState> {
    return this.election.observe()
  }

  // ---------- Contract methods (1:1 with subscriptionContract) ----------

  async list(): Promise<{ items: SubscriptionWithItems[]; total: number }> {
    const items = await this.store.list()
    return { items, total: items.length }
  }

  async get(input: { id: string }): Promise<SubscriptionWithItems> {
    const sub = await this.store.get(input.id)
    if (!sub) {
      throw new Error(`Subscription not found: ${input.id}`)
    }
    return sub
  }

  resolve(input: { rawUrl: string }): ResolvedFeed {
    return resolveFeedFromInput(input.rawUrl)
  }

  async add(input: SubscriptionCreateInput): Promise<SubscriptionWithItems> {
    const dup = await this.store.findDuplicateFeed(input.feedUrl)
    if (dup) {
      const err = new Error(SUBSCRIPTION_DUPLICATE_FEED_ERROR)
      ;(err as Error & { duplicateOf?: string }).duplicateOf = dup
      throw err
    }
    const created = await this.store.add(input)
    this.emitChanged()
    return created
  }

  async update(input: { id: string } & SubscriptionUpdateInput): Promise<SubscriptionWithItems> {
    const { id, ...patch } = input
    if (patch.feedUrl) {
      const dup = await this.store.findDuplicateFeed(patch.feedUrl, id)
      if (dup) {
        const err = new Error(SUBSCRIPTION_DUPLICATE_FEED_ERROR)
        ;(err as Error & { duplicateOf?: string }).duplicateOf = dup
        throw err
      }
    }
    const next = await this.store.update(id, patch)
    if (!next) {
      throw new Error(`Subscription not found: ${id}`)
    }
    this.emitChanged()
    return next
  }

  async remove(input: { id: string }): Promise<Record<string, never>> {
    await this.store.remove(input.id)
    this.emitChanged()
    return {}
  }

  async refresh(input: { id: string }): Promise<SubscriptionWithItems> {
    await this.scheduler.triggerNow(input.id)
    const sub = await this.store.get(input.id)
    if (!sub) {
      throw new Error(`Subscription not found: ${input.id}`)
    }
    return sub
  }

  async itemsList(input: {
    subscriptionId: string
    limit?: number
    offset?: number
  }): Promise<{ items: SubscriptionFeedItem[]; total: number }> {
    const sub = await this.store.get(input.subscriptionId)
    if (!sub) {
      throw new Error(`Subscription not found: ${input.subscriptionId}`)
    }
    const allItems = sub.items
    const offset = input.offset ?? 0
    const limit = input.limit ?? allItems.length
    return {
      items: allItems.slice(offset, offset + limit),
      total: allItems.length
    }
  }

  async itemsQueue(input: {
    subscriptionId: string
    itemId: string
  }): Promise<{ queued: boolean; taskId: string | null }> {
    const sub = await this.store.get(input.subscriptionId)
    if (!sub) {
      throw new Error(`Subscription not found: ${input.subscriptionId}`)
    }
    const item = sub.items.find((entry) => entry.id === input.itemId)
    if (!item) {
      return { queued: false, taskId: null }
    }
    if (item.addedToQueue) {
      return { queued: false, taskId: item.taskId ?? null }
    }
    const normalized: NormalizedFeedItem = {
      id: item.id,
      url: item.url,
      title: item.title,
      publishedAt: item.publishedAt
    }
    if (item.thumbnail) {
      normalized.thumbnail = item.thumbnail
    }
    const taskId = await this.enqueueItem({
      subscription: sub,
      item: normalized,
      trigger: 'manual'
    })
    if (taskId) {
      await this.store.markItemQueued(input.subscriptionId, input.itemId, taskId)
    }
    this.emitChanged()
    return { queued: taskId !== null, taskId }
  }

  // ---------- Feed-check pass ----------

  /**
   * Run a feed-check pass over every enabled subscription. Errors in one
   * subscription don't prevent others from being checked.
   */
  async refreshAll(): Promise<void> {
    const all = await this.store.list()
    for (const sub of all) {
      if (!sub.enabled) {
        continue
      }
      try {
        await this.refreshOne(sub.id)
      } catch (err) {
        this.log('warn', 'subscriptions: refreshOne failed', { id: sub.id, err })
      }
    }
  }

  /**
   * Run a feed-check pass over a single subscription. Used both by the
   * scheduler tick (for each enabled sub) and by manual `refresh(id)` calls.
   */
  async refreshOne(subscriptionId: string): Promise<void> {
    const sub = await this.store.get(subscriptionId)
    if (!sub) {
      return
    }
    const startedAt = this.now()
    await this.store.update(subscriptionId, {
      status: 'checking',
      lastCheckedAt: startedAt,
      lastError: undefined
    })
    try {
      const feed = await this.fetcher.fetch(sub.feedUrl)
      const decision: AutoDownloadDecision = decideAutoDownloads({
        subscription: sub,
        knownItems: sub.items,
        feed,
        isHistoryDup: this.isHistoryDup,
        now: this.now
      })
      await this.store.replaceItems(subscriptionId, decision.feedItemsToPersist)
      const queueable = dedupeFeedItems(decision.items).filter(
        (item) => !this.isHistoryDup(item.url)
      )
      for (const item of queueable) {
        try {
          const taskId = await this.enqueueItem({
            subscription: sub,
            item,
            trigger: 'auto'
          })
          if (taskId) {
            await this.store.markItemQueued(subscriptionId, item.id, taskId)
          }
        } catch (err) {
          this.log('warn', 'subscriptions: enqueueItem failed', {
            subscriptionId,
            itemId: item.id,
            err
          })
        }
      }
      const patch: SubscriptionUpdateInput & Partial<SubscriptionRule> = {
        status: 'up-to-date',
        lastSuccessAt: this.now(),
        lastError: undefined
      }
      if (decision.latestVideoTitle) {
        patch.latestVideoTitle = decision.latestVideoTitle
      }
      if (decision.latestPublishedAt !== null) {
        patch.latestVideoPublishedAt = decision.latestPublishedAt
      }
      if (decision.coverUrl) {
        patch.coverUrl = decision.coverUrl
      }
      if (typeof feed.title === 'string' && feed.title.trim()) {
        patch.title = feed.title.trim()
      }
      if (typeof feed.link === 'string' && feed.link.trim()) {
        patch.sourceUrl = feed.link.trim()
      }
      await this.store.update(subscriptionId, patch)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log('warn', 'subscriptions: feed-check failed', { id: subscriptionId, err })
      await this.store.update(subscriptionId, {
        status: 'failed',
        lastError: message,
        lastCheckedAt: this.now()
      })
    }
    this.emitChanged()
  }
}
