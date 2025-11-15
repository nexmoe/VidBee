import type {
  SubscriptionResolvedFeed,
  SubscriptionRule,
  SubscriptionUpdatePayload
} from '@shared/types'
import { atom } from 'jotai'
import { ipcServices } from '../lib/ipc'

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

export const setSubscriptionsAtom = atom(null, (_get, set, subscriptions: SubscriptionRule[]) => {
  set(subscriptionsAtom, subscriptions)
})

export const loadSubscriptionsAtom = atom(null, async (_get, set) => {
  try {
    const subscriptions = await ipcServices.subscriptions.list()
    set(subscriptionsAtom, subscriptions)
  } catch (error) {
    console.error('Failed to load subscriptions:', error)
  }
})

export interface CreateSubscriptionForm {
  url: string
  keywords?: string
  tags?: string
  onlyDownloadLatest?: boolean
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
      downloadDirectory: payload.downloadDirectory,
      namingTemplate: payload.namingTemplate,
      enabled: payload.enabled
    })
  }
)

export const updateSubscriptionAtom = atom(
  null,
  async (_get, _set, update: { id: string; data: SubscriptionUpdatePayload }) => {
    await ipcServices.subscriptions.update(update.id, update.data)
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
