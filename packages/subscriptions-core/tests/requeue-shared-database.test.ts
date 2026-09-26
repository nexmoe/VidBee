import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applySubscriptionsMigrations } from '@vidbee/db/subscriptions'
import { TASK_QUEUE_DDL_V1 } from '@vidbee/db/task-queue'
import { type Executor, SqlitePersistAdapter, TaskQueueAPI } from '@vidbee/task-queue'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { SubscriptionsApi } from '../src/api'
import type { FeedFetcher } from '../src/feed-parser'
import { createSqliteMetaStore, createSqliteSubscriptionsStore } from '../src/store'

const noopTimer = (): number => 0

const idleExecutor: Executor = {
  run: () => ({
    cancel: async () => {},
    pause: async () => {}
  })
}

type PersistDb = ConstructorParameters<typeof SqlitePersistAdapter>[0]['db']

const openQueue = (sqlite: Database.Database): TaskQueueAPI =>
  new TaskQueueAPI({
    persist: new SqlitePersistAdapter({
      db: sqlite as unknown as PersistDb,
      ownsConnection: false
    }),
    executor: idleExecutor,
    idleQueueKickMs: 0
  })

const taskCount = (sqlite: Database.Database): number => {
  const row = sqlite.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }
  return Number(row.n)
}

test('a second host keeps a queue link when the task exists only in the shared database', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'vidbee-shared-queue-'))
  const dbPath = join(directory, 'vidbee.db')
  const desktopSqlite = new Database(dbPath)
  desktopSqlite.pragma('journal_mode = WAL')
  desktopSqlite.exec(TASK_QUEUE_DDL_V1)
  applySubscriptionsMigrations((sql) => desktopSqlite.exec(sql), [])
  const apiSqlite = new Database(dbPath, { timeout: 5000 })
  const desktopQueue = openQueue(desktopSqlite)
  const apiQueue = openQueue(apiSqlite)
  let restartedSqlite: Database.Database | null = null
  let restartedQueue: TaskQueueAPI | null = null
  t.after(async () => {
    await restartedQueue?.stop()
    await apiQueue.stop()
    await desktopQueue.stop()
    restartedSqlite?.close()
    apiSqlite.close()
    desktopSqlite.close()
    rmSync(directory, { recursive: true, force: true })
  })
  await desktopQueue.start()
  await apiQueue.start()

  const imported = await desktopQueue.importCompleted({
    id: 'desktop-completed',
    input: {
      url: 'https://videos.example/kept',
      kind: 'subscription-item',
      title: 'Kept'
    },
    output: {
      filePath: join(directory, 'kept.mp4'),
      size: 4,
      durationMs: null,
      sha256: null
    }
  })
  assert.equal(apiQueue.get(imported.id), undefined)
  assert.equal(await apiQueue.hasTask(imported.id), true)

  const db = drizzle(apiSqlite)
  const store = createSqliteSubscriptionsStore({ db, now: () => 1_700_000_000_000 })
  const metaStore = createSqliteMetaStore({ db, now: () => 1_700_000_000_000 })
  const fetcher: FeedFetcher = { fetch: async () => ({ items: [] }) }
  const apiSubscriptions = new SubscriptionsApi({
    kind: 'api',
    pid: 1,
    store,
    metaStore,
    fetcher,
    taskExists: (taskId) => apiQueue.hasTask(taskId),
    enqueueItem: async () => {
      throw new Error('api host enqueued a task that still exists in the shared database')
    },
    leader: { scheduleInterval: noopTimer, clearInterval: () => undefined },
    scheduler: {
      refreshDedupeWindowMs: 0,
      setTimeoutImpl: noopTimer,
      clearTimeoutImpl: () => undefined
    }
  })
  const created = await apiSubscriptions.add({
    sourceUrl: 'https://videos.example/channel',
    feedUrl: 'https://videos.example/feed.xml',
    platform: 'custom',
    title: 'Channel',
    onlyDownloadLatest: false,
    autoDownload: false
  })
  await store.replaceItems(created.id, [
    {
      id: 'kept',
      url: 'https://videos.example/kept',
      title: 'Kept',
      publishedAt: Date.parse('2024-01-01T00:00:00.000Z')
    },
    {
      id: 'stale',
      url: 'https://videos.example/stale',
      title: 'Stale',
      publishedAt: Date.parse('2024-01-02T00:00:00.000Z')
    },
    {
      id: 'orphan',
      url: 'https://videos.example/orphan',
      title: 'Orphan',
      publishedAt: Date.parse('2024-01-03T00:00:00.000Z')
    }
  ])
  await store.markItemQueued(created.id, 'kept', imported.id)
  await store.markItemQueued(created.id, 'stale', imported.id)
  await store.markItemQueued(created.id, 'orphan', 'missing-task')

  const released = await apiSubscriptions.reconcileOrphanedTasks()
  assert.equal(released, 1)
  let sub = await apiSubscriptions.get({ id: created.id })
  const byId = (id: string) => {
    const item = sub.items.find((entry) => entry.id === id)
    assert.ok(item)
    return item
  }
  assert.equal(byId('orphan').addedToQueue, false)
  assert.equal(byId('orphan').taskId, undefined)
  assert.equal(byId('kept').taskId, imported.id)
  assert.equal(byId('stale').taskId, imported.id)

  const blocked = await apiSubscriptions.itemsQueue({
    subscriptionId: created.id,
    itemId: 'kept'
  })
  assert.equal(blocked.queued, false)
  assert.equal(blocked.taskId, imported.id)
  assert.equal(taskCount(apiSqlite), 1)

  restartedSqlite = new Database(dbPath, { timeout: 5000 })
  restartedQueue = openQueue(restartedSqlite)
  await restartedQueue.start()
  const restarted = restartedQueue
  assert.ok(restarted.get(imported.id))
  await desktopQueue.removeFromHistory(imported.id)
  assert.equal(await restarted.hasTask(imported.id), false)
  assert.ok(restarted.get(imported.id))

  const restartedSubscriptions = new SubscriptionsApi({
    kind: 'api',
    pid: 2,
    store,
    metaStore,
    fetcher,
    taskExists: (taskId) => restarted.hasTask(taskId),
    enqueueItem: async ({ item }) => {
      const added = await restarted.importCompleted({
        id: `requeued-${item.id}`,
        input: {
          url: item.url,
          kind: 'subscription-item',
          title: item.title
        },
        output: {
          filePath: join(directory, `${item.id}.mp4`),
          size: 4,
          durationMs: null,
          sha256: null
        }
      })
      return added.id
    },
    leader: { scheduleInterval: noopTimer, clearInterval: () => undefined },
    scheduler: {
      refreshDedupeWindowMs: 0,
      setTimeoutImpl: noopTimer,
      clearTimeoutImpl: () => undefined
    }
  })
  const requeued = await restartedSubscriptions.itemsQueue({
    subscriptionId: created.id,
    itemId: 'kept'
  })
  assert.equal(requeued.queued, true)
  assert.equal(requeued.taskId, 'requeued-kept')
  assert.equal(desktopQueue.get('requeued-kept'), undefined)
  assert.equal(await desktopQueue.hasTask('requeued-kept'), true)

  const clearedGhost = await restartedSubscriptions.reconcileOrphanedTasks()
  assert.equal(clearedGhost, 1)
  sub = await restartedSubscriptions.get({ id: created.id })
  assert.equal(byId('stale').addedToQueue, false)
  assert.equal(byId('stale').taskId, undefined)
  assert.equal(byId('kept').taskId, 'requeued-kept')
  assert.equal(taskCount(desktopSqlite), 1)
})

test('refreshing a host snapshot observes a removal made by another host', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'vidbee-shared-removal-'))
  const dbPath = join(directory, 'vidbee.db')
  const desktopSqlite = new Database(dbPath)
  desktopSqlite.exec(TASK_QUEUE_DDL_V1)
  applySubscriptionsMigrations((sql) => desktopSqlite.exec(sql), [])
  const apiSqlite = new Database(dbPath, { timeout: 5000 })
  const desktopQueue = openQueue(desktopSqlite)
  const apiQueue = openQueue(apiSqlite)
  t.after(async () => {
    await apiQueue.stop()
    await desktopQueue.stop()
    apiSqlite.close()
    desktopSqlite.close()
    rmSync(directory, { recursive: true, force: true })
  })
  await desktopQueue.start()
  const imported = await desktopQueue.importCompleted({
    input: { url: 'https://videos.example/removed', kind: 'subscription-item' },
    output: { filePath: join(directory, 'removed.mp4'), size: 4, durationMs: null, sha256: null }
  })
  await apiQueue.start()

  const makeSubscriptions = (sqlite: Database.Database, queue: TaskQueueAPI) => {
    const db = drizzle(sqlite)
    return new SubscriptionsApi({
      kind: queue === desktopQueue ? 'desktop' : 'api',
      pid: process.pid,
      store: createSqliteSubscriptionsStore({ db }),
      metaStore: createSqliteMetaStore({ db }),
      fetcher: { fetch: async () => ({ items: [] }) },
      taskExists: (taskId) => queue.hasTask(taskId),
      enqueueItem: async () => {
        throw new Error('refreshing subscriptions must not enqueue a download')
      }
    })
  }
  const desktop = makeSubscriptions(desktopSqlite, desktopQueue)
  const api = makeSubscriptions(apiSqlite, apiQueue)
  const created = await desktop.add({
    sourceUrl: 'https://videos.example/channel',
    feedUrl: 'https://videos.example/feed.xml',
    platform: 'custom',
    autoDownload: false
  })
  const store = createSqliteSubscriptionsStore({ db: drizzle(desktopSqlite) })
  await store.replaceItems(created.id, [
    { id: 'removed', url: 'https://videos.example/removed', title: 'Removed', publishedAt: 1 }
  ])
  await store.markItemQueued(created.id, 'removed', imported.id)
  const cached = await desktop.get({ id: created.id })
  assert.equal(cached.items[0]?.addedToQueue, true)

  let desktopNotifications = 0
  desktop.on('changed', () => {
    desktopNotifications += 1
  })
  const released = new Promise<void>((resolve) => {
    api.on('changed', () => resolve())
  })
  apiQueue.on('task-removed', ({ taskId }) => api.noteTaskRemoved(taskId))
  await apiQueue.removeFromHistory(imported.id)
  await released

  assert.equal(desktopNotifications, 0)
  assert.equal(cached.items[0]?.addedToQueue, true)
  assert.ok(desktopQueue.get(imported.id))
  const refreshed = await desktop.list()
  assert.equal(refreshed.items[0]?.items[0]?.addedToQueue, false)
  assert.equal(refreshed.items[0]?.items[0]?.taskId, undefined)
  assert.equal(taskCount(desktopSqlite), 0)
})
