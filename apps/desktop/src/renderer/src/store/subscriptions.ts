import type {
  SubscriptionResolvedFeed,
  SubscriptionRule,
  SubscriptionUpdatePayload
} from '@shared/types'
import type { SubscriptionDownloadPreferences } from '@vidbee/subscriptions-core/types'
import { atom } from 'jotai'
import { ipcServices } from '../lib/ipc'
import { logger } from '../lib/logger'

const normalizeCommaList = (value?: string): string[] => {
  if (!value) {
    return []
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)
}

export const subscriptionsAtom = atom<SubscriptionRule[]>([])

/**
 * Compare list payloads so an unchanged poll does not notify subscribers.
 * @param current Rules already in the store.
 * @param next Rules returned by the latest list call.
 * @returns True when every field matches.
 */
function sameSubscriptionList(current: SubscriptionRule[], next: SubscriptionRule[]): boolean {
  return JSON.stringify(current) === JSON.stringify(next)
}

export const setSubscriptionsAtom = atom(null, (get, set, subscriptions: SubscriptionRule[]) => {
  if (sameSubscriptionList(get(subscriptionsAtom), subscriptions)) {
    return
  }
  set(subscriptionsAtom, subscriptions)
})

export const loadSubscriptionsAtom = atom(null, async (get, set) => {
  try {
    const subscriptions = await ipcServices.subscriptions.list()
    if (sameSubscriptionList(get(subscriptionsAtom), subscriptions)) {
      return
    }
    set(subscriptionsAtom, subscriptions)
  } catch (error) {
    logger.error('Failed to load subscriptions:', error)
  }
})

export interface CreateSubscriptionForm extends SubscriptionDownloadPreferences {
  url: string
  keywords?: string
  tags?: string
  onlyDownloadLatest?: boolean
  autoDownload?: boolean
  downloadDirectory?: string
  namingTemplate?: string
  enabled?: boolean
}

export const createSubscriptionAtom = atom(
  null,
  async (_get, _set, payload: CreateSubscriptionForm) => {
    await ipcServices.subscriptions.create({
      url: payload.url,
      keywords: normalizeCommaList(payload.keywords),
      tags: normalizeCommaList(payload.tags),
      onlyDownloadLatest: payload.onlyDownloadLatest,
      autoDownload: payload.autoDownload,
      downloadType: payload.downloadType,
      downloadQuality: payload.downloadQuality,
      downloadContainer: payload.downloadContainer,
      downloadDirectory: payload.downloadDirectory,
      namingTemplate: payload.namingTemplate,
      enabled: payload.enabled
    })
  }
)

/** Publish the persisted snapshot before a saved dialog can be reopened. */
export const updateSubscriptionAtom = atom(
  null,
  async (_get, set, update: { id: string; data: SubscriptionUpdatePayload }) => {
    const updated = await ipcServices.subscriptions.update(update.id, update.data)
    if (updated) {
      set(subscriptionsAtom, (current) =>
        current.map((subscription) => (subscription.id === updated.id ? updated : subscription))
      )
    }
  }
)

export const removeSubscriptionAtom = atom(null, async (_get, _set, id: string) => {
  await ipcServices.subscriptions.remove(id)
})

export const refreshSubscriptionAtom = atom(null, async (_get, _set, id?: string) => {
  await ipcServices.subscriptions.refresh(id)
})

export const resolveFeedAtom = atom(
  null,
  async (_get, _set, url: string): Promise<SubscriptionResolvedFeed> => {
    return ipcServices.subscriptions.resolve(url)
  }
)
