// Public surface of @vidbee/subscriptions-core. Adapters import from here.

export * from './types'
export * from './schemas'
export {
  buildDefaultSubscriptionDirectory,
  sanitizeCommaList,
  sanitizeTemplateInput
} from './form'
export {
  disabledStatusMeta,
  getSubscriptionStatusMeta,
  resolveSubscriptionItemStatus
} from './status'
export type { SubscriptionItemQueueStatus, SubscriptionStatusMeta } from './status'
export { subscriptionContract } from './contract'
export type { SubscriptionContract } from './contract'

export { resolveFeedFromInput, buildFeedKey } from './feed-resolver'

export {
  dedupeFeedItems,
  normalizeFeedItems,
  resolveFeedCover,
  resolveThumbnail
} from './feed-items'
export type { NormalizeOptions } from './feed-items'

export { decideAutoDownloads } from './auto-download'
export type { AutoDownloadInputs } from './auto-download'

export { RssParserFeedFetcher } from './feed-parser'
export type { FeedFetcher } from './feed-parser'

export { LeaderElection } from './leader'
export type { LeaderElectionOptions, MetaStore } from './leader'

export { FeedCheckScheduler } from './scheduler'
export type { FeedCheckSchedulerOptions } from './scheduler'

export {
  createSqliteMetaStore,
  createSqliteSubscriptionsStore,
  InMemoryMetaStore
} from './store'
export type { CreateSqliteStoresOptions, SubscriptionsStore } from './store'

export { SubscriptionsApi } from './api'
export type { EnqueueItem, EnqueueItemContext, SubscriptionsApiOptions } from './api'
