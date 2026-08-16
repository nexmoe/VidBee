/**
 * apps/api host for @vidbee/subscriptions-core (NEX-132 Phase B · Web/API).
 *
 * Owns the single `SubscriptionsApi` the `/rpc/subscriptions/*` routes feed
 * into, and bridges subscription items into the shared task-queue (priority
 * 10, group-keyed by subscription id, kind 'subscription-item').
 *
 * Storage: a dedicated `subscriptions.db` (sibling of `task-queue.db`).
 * Sharing the SQLite file with Desktop is what makes the leader-election
 * meaningful; on standalone API deployments the API simply always wins the
 * lease and runs feed-checks itself.
 *
 * Operational env vars:
 *   VIDBEE_SUBSCRIPTIONS_DB    – override the default subscriptions.db path
 *
 * Existing task-queue env vars (`VIDBEE_DOWNLOAD_DIR`,
 * `VIDBEE_PERSIST_QUEUE`, …) are reused via the shared host wiring.
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { SUBSCRIPTIONS_DDL_V1 } from '@vidbee/db/subscriptions'
import {
  createSqliteMetaStore,
  createSqliteSubscriptionsStore,
  RssParserFeedFetcher,
  SubscriptionsApi
} from '@vidbee/subscriptions-core'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { apiDefaultDownloadDir, taskQueue } from './task-queue-host'

const require = createRequire(import.meta.url)

const trimEnv = (name: string): string | undefined => {
  const v = process.env[name]?.trim()
  return v && v.length > 0 ? v : undefined
}

const resolveDbPath = (): string => {
  const override = trimEnv('VIDBEE_SUBSCRIPTIONS_DB')
  if (override) {
    return override
  }
  return path.join(apiDefaultDownloadDir, '.vidbee', 'subscriptions.db')
}

let api: SubscriptionsApi | null = null
let started = false

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
  const dbPath = resolveDbPath()
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  const sqlite = new Database(dbPath, { timeout: 5000 })
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(SUBSCRIPTIONS_DDL_V1)
  const db = drizzle(sqlite)

  const store = createSqliteSubscriptionsStore({ db })
  const metaStore = createSqliteMetaStore({ db })

  api = new SubscriptionsApi({
    kind: 'api',
    pid: process.pid,
    store,
    metaStore,
    fetcher: new RssParserFeedFetcher(),
    enqueueItem: async ({ subscription, item }) => {
      const tags = Array.from(new Set([subscription.platform, ...subscription.tags]))
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
            tags
          }
        },
        priority: 10,
        groupKey: subscription.id
      })
      return result.id
    },
    log: (level, msg, meta) => {
      // The API uses fastify's logger via stdout; emit through console here
      // so the message lands in the same stream without binding to fastify.
      const line = meta === undefined ? msg : `${msg} ${JSON.stringify(meta)}`
      if (level === 'error') {
        console.error(`subscriptions: ${line}`)
      } else if (level === 'warn') {
        console.warn(`subscriptions: ${line}`)
      } else {
        console.info(`subscriptions: ${line}`)
      }
    }
  })
  return api
}

export const startApiSubscriptions = async (): Promise<void> => {
  if (started) {
    return
  }
  await getApiSubscriptions().start()
  started = true
}

export const stopApiSubscriptions = async (): Promise<void> => {
  if (!started) {
    return
  }
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
