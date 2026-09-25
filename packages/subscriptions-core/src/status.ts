import type { SubscriptionStatus } from './types'

export interface SubscriptionStatusMeta {
  dotClass: string
  textClass: string
  label: string
}

const fallbackStatusMeta: SubscriptionStatusMeta = {
  dotClass: 'bg-muted-foreground',
  textClass: 'text-muted-foreground',
  label: 'subscriptions.status.idle'
}

const enabledStatusMeta: Record<SubscriptionStatus, SubscriptionStatusMeta> = {
  'up-to-date': {
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-600',
    label: 'subscriptions.status.up-to-date'
  },
  checking: {
    dotClass: 'bg-sky-500',
    textClass: 'text-sky-600',
    label: 'subscriptions.status.checking'
  },
  failed: {
    dotClass: 'bg-red-500',
    textClass: 'text-red-600',
    label: 'subscriptions.status.failed'
  },
  idle: fallbackStatusMeta
}

export const disabledStatusMeta: SubscriptionStatusMeta = {
  dotClass: 'bg-zinc-400',
  textClass: 'text-muted-foreground',
  label: 'subscriptions.fields.disabled'
}

/**
 * Resolve the subscription status styles without crashing on stale or unknown values.
 *
 * @param status The persisted subscription status.
 * @param enabled Whether the subscription is enabled.
 * @returns The status style metadata used by the subscriptions UI.
 */
export const getSubscriptionStatusMeta = (
  status: string | undefined,
  enabled: boolean
): SubscriptionStatusMeta => {
  if (!enabled) {
    return disabledStatusMeta
  }

  if (status && status in enabledStatusMeta) {
    return enabledStatusMeta[status as SubscriptionStatus]
  }

  return fallbackStatusMeta
}

export type SubscriptionItemQueueStatus =
  | 'notQueued'
  | 'queued'
  | 'pending'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'error'
  | 'cancelled'

/**
 * Map a feed item to the live download status when it has been queued.
 *
 * @param item Feed item with optional task/download id.
 * @param downloadById Live and history downloads keyed by id.
 * @returns Queue or download status used by the subscriptions grid.
 */
export const resolveSubscriptionItemStatus = (
  item: { addedToQueue: boolean; downloadId?: string; taskId?: string },
  downloadById: ReadonlyMap<string, { status: string }>
): SubscriptionItemQueueStatus => {
  if (!item.addedToQueue) {
    return 'notQueued'
  }
  const id = item.taskId ?? item.downloadId
  const matched = id ? downloadById.get(id) : undefined
  // No live task means the stored queue link is stale.
  if (!matched) {
    return 'notQueued'
  }
  switch (matched.status) {
    case 'pending':
    case 'downloading':
    case 'processing':
    case 'completed':
    case 'cancelled':
      return matched.status
    case 'error':
    case 'failed':
      return 'error'
    default:
      return 'queued'
  }
}
