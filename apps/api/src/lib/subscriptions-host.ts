/**
 * apps/api host for @vidbee/subscriptions-core (NEX-132 Phase B · Web/API).
 *
 * Owns the single `SubscriptionsApi` the `/rpc/subscriptions/*` routes feed
 * into, and bridges subscription items into the shared task-queue (priority
 * 10, group-keyed by subscription id, kind 'subscription-item').
 *
 * Storage: the unified `vidbee.db` shared with the task queue and transcripts.
 * Sharing the SQLite file with Desktop is what makes the leader-election
 * meaningful; on standalone API deployments the API simply always wins the
 * lease and runs feed-checks itself.
 *
 * Existing task-queue env vars (`VIDBEE_DOWNLOAD_DIR`, `VIDBEE_DB`, …) are
 * reused via the shared host wiring.
 */
import { log } from '@vidbee/logger'
import {
  createSqliteMetaStore,
  createSqliteSubscriptionsStore,
  RssParserFeedFetcher,
  SubscriptionsApi
} from '@vidbee/subscriptions-core'

import { getDatabaseConnection } from './database'
import { taskQueue } from './task-queue-host'
import { toWebDownloadRuntimeSettings, webSettingsStore } from './web-settings-store'

let api: SubscriptionsApi | null = null
let started = false
let removeTaskListener: (() => void) | null = null

/**
 * Open (or reuse) the singleton SubscriptionsApi for the API host.
 *
 * The drizzle handle is intentionally held inside the closure: we want a
 * single long-lived better-sqlite3 connection so leader-election CAS runs
 * inside one process's transaction, not split across re-opened handles.
 */
export const getApiSubscriptions = (): SubscriptionsApi => {
  if (api) {
    return api
  }
  const { db } = getDatabaseConnection()

  const store = createSqliteSubscriptionsStore({ db })
  const metaStore = createSqliteMetaStore({ db })

  api = new SubscriptionsApi({
    kind: 'api',
    pid: process.pid,
    store,
    metaStore,
    fetcher: new RssParserFeedFetcher(),
    // `get` is this process's startup snapshot. A task Desktop wrote to the
    // shared database after that is still a real download.
    taskExists: (taskId) => taskQueue.hasTask(taskId),
    enqueueItem: async ({ subscription, item }) => {
      const tags = Array.from(new Set([subscription.platform, ...subscription.tags]))
      const settings = toWebDownloadRuntimeSettings(await webSettingsStore.get())
      const result = await taskQueue.add({
        input: {
          url: item.url,
          kind: 'subscription-item',
          title: item.title,
          ...(item.thumbnail === undefined ? {} : { thumbnail: item.thumbnail }),
          subscriptionId: subscription.id,
          options: {
            origin: 'subscription',
            subscriptionId: subscription.id,
            itemId: item.id,
            ...(subscription.downloadDirectory
              ? { customDownloadPath: subscription.downloadDirectory }
              : {}),
            ...(subscription.namingTemplate
              ? { customFilenameTemplate: subscription.namingTemplate }
              : {}),
            settings,
            tags
          }
        },
        priority: 10,
        groupKey: subscription.id
      })
      return result.id
    },
    log: (level, msg, meta) => {
      const event = {
        event: 'subscriptions',
        message: msg,
        ...(meta === undefined ? {} : { meta })
      }
      if (level === 'error') {
        log.error(event)
      } else if (level === 'warn') {
        log.warn(event)
      } else {
        log.info(event)
      }
    }
  })
  return api
}

export const startApiSubscriptions = async (): Promise<void> => {
  if (started) {
    return
  }
  const subscriptions = getApiSubscriptions()
  await subscriptions.start()
  removeTaskListener = taskQueue.on('task-removed', (event) => {
    subscriptions.noteTaskRemoved(event.taskId)
  })
  started = true
}

export const stopApiSubscriptions = async (): Promise<void> => {
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
 * holds for it (NEX-132 regression checklist: "用户暂停 / 删除订阅后，已经
 * 入队但未开始的 subscription-item 任务被自动取消").
 *
 * Iterates the task list and cancels every queued/running/processing/paused
 * task whose `groupKey` matches the subscription id. Errors on individual
 * cancellations are swallowed so a stuck task can't block subscription
 * removal.
 */
export const removeApiSubscription = async (id: string): Promise<void> => {
  await getApiSubscriptions().remove({ id })
  let cursor: string | null = null
  do {
    const page = taskQueue.list({ groupKey: id, limit: 200, cursor })
    for (const task of page.tasks) {
      if (
        task.status === 'queued' ||
        task.status === 'running' ||
        task.status === 'processing' ||
        task.status === 'paused' ||
        task.status === 'retry-scheduled'
      ) {
        try {
          await taskQueue.cancel(task.id)
        } catch {
          // Best-effort: ignore tasks that already moved to a terminal state.
        }
      }
    }
    cursor = page.nextCursor
  } while (cursor)
}
