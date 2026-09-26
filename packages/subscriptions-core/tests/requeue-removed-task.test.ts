import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applySubscriptionsMigrations } from '@vidbee/db/subscriptions'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { SubscriptionsApi } from '../src/api'
import type { FeedFetcher } from '../src/feed-parser'
import { resolveSubscriptionItemStatus } from '../src/status'
import { createSqliteMetaStore, createSqliteSubscriptionsStore } from '../src/store'
import type { ParsedFeed, ParsedFeedItem, SubscriptionWithItems } from '../src/types'

const noopTimer = (): number => 0

const feedItem = (id: string, isoDate: string): ParsedFeedItem => ({
  guid: id,
  title: `Title ${id}`,
  link: `https://videos.example/${id}`,
  isoDate
})

const openApi = (live: Set<string>) => {
  const sqlite = new Database(':memory:')
  applySubscriptionsMigrations((sql) => sqlite.exec(sql), [])
  const db = drizzle(sqlite)
  let clock = 1_700_000_000_000
  const now = (): number => clock
  const store = createSqliteSubscriptionsStore({ db, now })
  const metaStore = createSqliteMetaStore({ db, now })
  const fetcher: FeedFetcher & { feed: ParsedFeed } = {
    feed: { items: [] },
    fetch: async () => fetcher.feed
  }
  const enqueued: string[] = []
  let taskSeq = 0
  const api = new SubscriptionsApi({
    kind: 'api',
    pid: 1,
    store,
    metaStore,
    fetcher,
    now,
    taskExists: (taskId) => live.has(taskId),
    enqueueItem: async ({ item }) => {
      taskSeq += 1
      const taskId = `task-${item.id}-${taskSeq}`
      live.add(taskId)
      enqueued.push(item.id)
      return taskId
    },
    leader: {
      scheduleInterval: noopTimer,
      clearInterval: () => undefined
    },
    scheduler: {
      refreshDedupeWindowMs: 0,
      setTimeoutImpl: noopTimer,
      clearTimeoutImpl: () => undefined
    }
  })
  return {
    sqlite,
    api,
    fetcher,
    enqueued,
    live,
    advance: (ms = 1) => {
      clock += ms
    }
  }
}

const itemById = (sub: SubscriptionWithItems, id: string) => {
  const item = sub.items.find((entry) => entry.id === id)
  assert.ok(item, `missing feed item ${id}`)
  return item
}

test('resolveSubscriptionItemStatus treats a deleted task id as not queued', () => {
  const status = resolveSubscriptionItemStatus(
    { addedToQueue: true, taskId: 'deleted-task' },
    new Map()
  )
  assert.equal(status, 'notQueued')
  assert.equal(
    resolveSubscriptionItemStatus(
      { addedToQueue: true, taskId: 'live-task' },
      new Map([['live-task', { status: 'completed' }]])
    ),
    'completed'
  )
})

test('removing a download clears the queue link, allows re-add, and stays seen', async () => {
  const live = new Set<string>(['task-a', 'task-b', 'task-c'])
  const ctx = openApi(live)
  const changes: number[] = []
  ctx.api.on('changed', () => {
    changes.push(1)
  })

  const created = await ctx.api.add({
    sourceUrl: 'https://videos.example/channel',
    feedUrl: 'https://videos.example/feed.xml',
    platform: 'custom',
    title: 'Channel',
    onlyDownloadLatest: false,
    autoDownload: true
  })
  const store = createSqliteSubscriptionsStore({
    db: drizzle(ctx.sqlite),
    now: () => 1_700_000_000_000
  })
  await store.replaceItems(created.id, [
    {
      id: 'a',
      url: 'https://videos.example/a',
      title: 'Title a',
      publishedAt: Date.parse('2024-01-01T00:00:00.000Z')
    },
    {
      id: 'b',
      url: 'https://videos.example/b',
      title: 'Title b',
      publishedAt: Date.parse('2024-01-02T00:00:00.000Z')
    },
    {
      id: 'c',
      url: 'https://videos.example/c',
      title: 'Title c',
      publishedAt: Date.parse('2024-01-03T00:00:00.000Z')
    }
  ])
  await store.markItemQueued(created.id, 'a', 'task-a')
  await store.markItemQueued(created.id, 'b', 'task-b')
  await store.markItemQueued(created.id, 'c', 'task-c')

  live.delete('task-a')
  const releasedOne = await ctx.api.releaseRemovedTasks(['task-a'])
  assert.equal(releasedOne, 1)
  let sub = await ctx.api.get({ id: created.id })
  assert.equal(itemById(sub, 'a').addedToQueue, false)
  assert.equal(itemById(sub, 'a').taskId, undefined)
  assert.equal(itemById(sub, 'b').addedToQueue, true)
  assert.equal(itemById(sub, 'b').taskId, 'task-b')
  assert.equal(sub.items.length, 3)

  const blocked = await ctx.api.itemsQueue({ subscriptionId: created.id, itemId: 'b' })
  assert.equal(blocked.queued, false)
  assert.equal(blocked.taskId, 'task-b')
  assert.deepEqual(ctx.enqueued, [])

  const readded = await ctx.api.itemsQueue({ subscriptionId: created.id, itemId: 'a' })
  assert.equal(readded.queued, true)
  assert.equal(ctx.enqueued.at(-1), 'a')
  sub = await ctx.api.get({ id: created.id })
  assert.equal(itemById(sub, 'a').addedToQueue, true)
  assert.equal(itemById(sub, 'a').taskId, readded.taskId)

  const again = await ctx.api.itemsQueue({ subscriptionId: created.id, itemId: 'a' })
  assert.equal(again.queued, false)
  assert.equal(again.taskId, readded.taskId)

  live.delete('task-b')
  live.delete('task-c')
  const beforeBulk = changes.length
  ctx.api.noteTaskRemoved('task-b')
  ctx.api.noteTaskRemoved('task-c')
  await new Promise((resolve) => {
    setImmediate(resolve)
  })
  assert.equal(changes.length, beforeBulk + 1)
  sub = await ctx.api.get({ id: created.id })
  assert.equal(itemById(sub, 'b').addedToQueue, false)
  assert.equal(itemById(sub, 'b').taskId, undefined)
  assert.equal(itemById(sub, 'c').addedToQueue, false)
  assert.equal(itemById(sub, 'c').taskId, undefined)
  assert.equal(itemById(sub, 'a').taskId, readded.taskId)

  ctx.fetcher.feed = {
    items: [
      feedItem('a', '2024-03-01T00:00:00.000Z'),
      feedItem('b', '2024-01-02T00:00:00.000Z'),
      feedItem('c', '2024-01-03T00:00:00.000Z'),
      feedItem('d', '2024-02-01T00:00:00.000Z')
    ]
  }
  ctx.advance()
  const beforeRefresh = [...ctx.enqueued]
  await ctx.api.refresh({ id: created.id })
  assert.deepEqual(ctx.enqueued.slice(beforeRefresh.length), ['d'])
  sub = await ctx.api.get({ id: created.id })
  assert.equal(itemById(sub, 'a').taskId, readded.taskId)
  assert.equal(itemById(sub, 'b').addedToQueue, false)
  assert.equal(itemById(sub, 'd').addedToQueue, true)
  assert.equal(sub.items.length, 4)

  ctx.sqlite.close()
})

test('startup reconcile drops orphaned task ids and still allows an explicit re-add', async () => {
  const firstLive = new Set<string>(['task-old', 'task-live'])
  const first = openApi(firstLive)
  const created = await first.api.add({
    sourceUrl: 'https://videos.example/channel',
    feedUrl: 'https://videos.example/feed.xml',
    platform: 'custom',
    title: 'Channel',
    onlyDownloadLatest: false,
    autoDownload: true
  })
  const store = createSqliteSubscriptionsStore({
    db: drizzle(first.sqlite),
    now: () => 1_700_000_000_000
  })
  await store.replaceItems(created.id, [
    {
      id: 'old',
      url: 'https://videos.example/old',
      title: 'Old',
      publishedAt: Date.parse('2024-01-01T00:00:00.000Z')
    },
    {
      id: 'live',
      url: 'https://videos.example/live',
      title: 'Live',
      publishedAt: Date.parse('2024-01-02T00:00:00.000Z')
    }
  ])
  await store.markItemQueued(created.id, 'old', 'task-old')
  await store.markItemQueued(created.id, 'live', 'task-live')

  const restartedLive = new Set<string>(['task-live'])
  let clock = 1_700_000_000_000
  const restarted = new SubscriptionsApi({
    kind: 'desktop',
    pid: 2,
    store,
    metaStore: createSqliteMetaStore({ db: drizzle(first.sqlite), now: () => clock }),
    fetcher: first.fetcher,
    now: () => clock,
    taskExists: (taskId) => restartedLive.has(taskId),
    enqueueItem: async ({ item }) => {
      const taskId = `restarted-${item.id}`
      restartedLive.add(taskId)
      return taskId
    },
    leader: {
      scheduleInterval: noopTimer,
      clearInterval: () => undefined
    },
    scheduler: {
      refreshDedupeWindowMs: 0,
      setTimeoutImpl: noopTimer,
      clearTimeoutImpl: () => undefined
    }
  })
  let notifications = 0
  restarted.on('changed', () => {
    notifications += 1
  })
  await restarted.start()
  assert.equal(notifications, 1)
  let sub = await restarted.get({ id: created.id })
  assert.equal(itemById(sub, 'old').addedToQueue, false)
  assert.equal(itemById(sub, 'old').taskId, undefined)
  assert.equal(itemById(sub, 'live').addedToQueue, true)
  assert.equal(itemById(sub, 'live').taskId, 'task-live')

  const queued = await restarted.itemsQueue({ subscriptionId: created.id, itemId: 'old' })
  assert.equal(queued.queued, true)
  assert.equal(queued.taskId, 'restarted-old')

  first.fetcher.feed = {
    items: [
      feedItem('old', '2024-04-01T00:00:00.000Z'),
      feedItem('live', '2024-01-02T00:00:00.000Z')
    ]
  }
  clock += 1
  await restarted.refresh({ id: created.id })
  sub = await restarted.get({ id: created.id })
  assert.equal(itemById(sub, 'old').taskId, 'restarted-old')
  assert.equal(itemById(sub, 'live').taskId, 'task-live')
  assert.equal(
    sub.items.some((entry) => entry.id === 'fresh'),
    false
  )

  await restarted.stop()
  first.sqlite.close()
})

test('manual enqueue reconciles a stale queue flag before accepting the item', async () => {
  const live = new Set<string>()
  const ctx = openApi(live)
  const created = await ctx.api.add({
    sourceUrl: 'https://videos.example/channel',
    feedUrl: 'https://videos.example/feed.xml',
    platform: 'custom',
    title: 'Channel',
    autoDownload: false
  })
  const store = createSqliteSubscriptionsStore({
    db: drizzle(ctx.sqlite),
    now: () => 1_700_000_000_000
  })
  await store.replaceItems(created.id, [
    {
      id: 'gone',
      url: 'https://videos.example/gone',
      title: 'Gone',
      publishedAt: Date.parse('2024-01-01T00:00:00.000Z')
    }
  ])
  await store.markItemQueued(created.id, 'gone', 'deleted-task')

  const queued = await ctx.api.itemsQueue({ subscriptionId: created.id, itemId: 'gone' })
  assert.equal(queued.queued, true)
  const sub = await ctx.api.get({ id: created.id })
  assert.equal(itemById(sub, 'gone').addedToQueue, true)
  assert.equal(itemById(sub, 'gone').taskId, queued.taskId)
  assert.notEqual(itemById(sub, 'gone').taskId, 'deleted-task')

  ctx.sqlite.close()
})
