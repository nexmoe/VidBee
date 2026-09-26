/**
 * SQLite-backed implementation of `SubscriptionsStore` and `MetaStore`,
 * built on top of `@vidbee/db`'s Drizzle tables.
 *
 * The package's runtime API is async even though `better-sqlite3` is sync,
 * to keep room for future remote stores (e.g. Postgres or a remote API
 * client). Hosts that already hold a `BetterSQLite3Database` plug it in
 * here; the public `SubscriptionsAPI` only sees the abstract interfaces.
 */
import { randomUUID } from 'node:crypto'
import {
  type SubscriptionInsert,
  type SubscriptionItemInsert,
  type SubscriptionItemRow,
  type SubscriptionRow,
  subscriptionItemsTable,
  subscriptionsMetaTable,
  subscriptionsTable
} from '@vidbee/db/subscriptions'
import { and, desc, eq, inArray, isNotNull, or } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { buildFeedKey } from './feed-resolver'
import type { MetaStore } from './leader'
import type {
  LeaderKind,
  LeaderState,
  NormalizedFeedItem,
  SubscriptionCreateInput,
  SubscriptionFeedItem,
  SubscriptionRule,
  SubscriptionUpdateInput,
  SubscriptionWithItems
} from './types'

const sanitizeList = (values?: string[]): string[] => {
  if (!values || values.length === 0) {
    return []
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

const parseStringArray = (value: string | null | undefined): string[] => {
  if (!value) {
    return []
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? sanitizeList(parsed as string[]) : []
  } catch {
    return []
  }
}

const stringifyArray = (values: string[]): string => JSON.stringify(sanitizeList(values))

const boolToInt = (value: boolean): number => (value ? 1 : 0)
const intToBool = (value: number | null | undefined): boolean => value === 1

const rowToSubscription = (row: SubscriptionRow): SubscriptionRule => {
  const rule: SubscriptionRule = {
    id: row.id,
    title: row.title,
    sourceUrl: row.sourceUrl,
    feedUrl: row.feedUrl,
    platform: row.platform as SubscriptionRule['platform'],
    keywords: parseStringArray(row.keywords),
    tags: parseStringArray(row.tags),
    onlyDownloadLatest: intToBool(row.onlyDownloadLatest),
    autoDownload: intToBool(row.autoDownload),
    enabled: intToBool(row.enabled),
    status: row.status as SubscriptionRule['status'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
  if (row.coverUrl) {
    rule.coverUrl = row.coverUrl
  }
  if (row.latestVideoTitle) {
    rule.latestVideoTitle = row.latestVideoTitle
  }
  if (row.latestVideoPublishedAt !== null) {
    rule.latestVideoPublishedAt = row.latestVideoPublishedAt
  }
  if (row.lastCheckedAt !== null) {
    rule.lastCheckedAt = row.lastCheckedAt
  }
  if (row.lastSuccessAt !== null) {
    rule.lastSuccessAt = row.lastSuccessAt
  }
  if (row.lastError) {
    rule.lastError = row.lastError
  }
  if (row.downloadDirectory) {
    rule.downloadDirectory = row.downloadDirectory
  }
  if (row.namingTemplate) {
    rule.namingTemplate = row.namingTemplate
  }
  return rule
}

const rowToFeedItem = (row: SubscriptionItemRow): SubscriptionFeedItem => {
  const item: SubscriptionFeedItem = {
    id: row.itemId,
    url: row.url,
    title: row.title,
    publishedAt: row.publishedAt,
    addedToQueue: intToBool(row.added)
  }
  if (row.thumbnail) {
    item.thumbnail = row.thumbnail
  }
  if (row.taskId) {
    item.taskId = row.taskId
  }
  return item
}

const subscriptionToInsert = (rule: SubscriptionRule, now: number): SubscriptionInsert => {
  const payload: SubscriptionInsert = {
    id: rule.id,
    title: rule.title,
    sourceUrl: rule.sourceUrl,
    feedUrl: rule.feedUrl,
    platform: rule.platform,
    keywords: stringifyArray(rule.keywords),
    tags: stringifyArray(rule.tags),
    onlyDownloadLatest: boolToInt(rule.onlyDownloadLatest),
    autoDownload: boolToInt(rule.autoDownload),
    enabled: boolToInt(rule.enabled),
    status: rule.status,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt ?? now
  }
  if (rule.coverUrl !== undefined) {
    payload.coverUrl = rule.coverUrl
  }
  if (rule.latestVideoTitle !== undefined) {
    payload.latestVideoTitle = rule.latestVideoTitle
  }
  if (rule.latestVideoPublishedAt !== undefined) {
    payload.latestVideoPublishedAt = rule.latestVideoPublishedAt
  }
  if (rule.lastCheckedAt !== undefined) {
    payload.lastCheckedAt = rule.lastCheckedAt
  }
  if (rule.lastSuccessAt !== undefined) {
    payload.lastSuccessAt = rule.lastSuccessAt
  }
  if (rule.lastError !== undefined) {
    payload.lastError = rule.lastError
  }
  if (rule.downloadDirectory !== undefined) {
    payload.downloadDirectory = rule.downloadDirectory
  }
  if (rule.namingTemplate !== undefined) {
    payload.namingTemplate = rule.namingTemplate
  }
  return payload
}

export interface SubscriptionsStore {
  list(): Promise<SubscriptionWithItems[]>
  get(id: string): Promise<SubscriptionWithItems | null>
  /** Returns the matched id when `feedUrl` collides, ignoring `ignoreId`. */
  findDuplicateFeed(feedUrl: string, ignoreId?: string): Promise<string | null>
  add(input: SubscriptionCreateInput): Promise<SubscriptionWithItems>
  update(
    id: string,
    patch: SubscriptionUpdateInput & Partial<SubscriptionRule>
  ): Promise<SubscriptionWithItems | null>
  remove(id: string): Promise<boolean>
  /** Replace the entire `subscription_items` snapshot for one subscription. */
  replaceItems(subscriptionId: string, items: NormalizedFeedItem[]): Promise<void>
  /**
   * Mark an item as `added` and link the spawned task id. Idempotent — if
   * the row already records the same taskId nothing changes.
   */
  markItemQueued(subscriptionId: string, itemId: string, taskId: string | null): Promise<void>
  /**
   * Clear the queue flag and task id for the selected rows. The item rows
   * stay so the feed still treats them as already seen.
   */
  clearQueueLinks(selector: QueueLinkSelector): Promise<number>
  /**
   * Clear queue links whose task id is missing or rejected by `isLive`.
   * Returns how many rows changed.
   */
  clearOrphanedQueueLinks(isLive: (taskId: string) => boolean | Promise<boolean>): Promise<number>
}

export interface QueueLinkSelector {
  taskIds?: readonly string[]
  items?: readonly { subscriptionId: string; itemId: string }[]
}

export interface CreateSqliteStoresOptions {
  db: BetterSQLite3Database
  /** Defaults to `Date.now`. */
  now?: () => number
  /** Defaults to `crypto.randomUUID`. */
  generateId?: () => string
}

const uniqueIds = (values: readonly string[] | undefined): string[] => {
  if (!values || values.length === 0) {
    return []
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

/**
 * Drop queue flags without deleting feed rows. `added = 0` is what lets a
 * user queue the item again; keeping the row is what blocks auto-download.
 */
const clearQueueLinkRows = (
  db: BetterSQLite3Database,
  at: number,
  taskIds: readonly string[],
  items: readonly { subscriptionId: string; itemId: string }[]
): number => {
  if (taskIds.length === 0 && items.length === 0) {
    return 0
  }
  const cleared = { added: 0, taskId: null, updatedAt: at }
  let changes = 0
  db.transaction((tx) => {
    if (taskIds.length > 0) {
      const result = tx
        .update(subscriptionItemsTable)
        .set(cleared)
        .where(inArray(subscriptionItemsTable.taskId, [...taskIds]))
        .run()
      changes += result.changes ?? 0
    }
    for (const item of items) {
      const result = tx
        .update(subscriptionItemsTable)
        .set(cleared)
        .where(
          and(
            eq(subscriptionItemsTable.subscriptionId, item.subscriptionId),
            eq(subscriptionItemsTable.itemId, item.itemId),
            or(eq(subscriptionItemsTable.added, 1), isNotNull(subscriptionItemsTable.taskId))
          )
        )
        .run()
      changes += result.changes ?? 0
    }
  })
  return changes
}

export const createSqliteSubscriptionsStore = ({
  db,
  now = () => Date.now(),
  generateId = () => randomUUID()
}: CreateSqliteStoresOptions): SubscriptionsStore => {
  const attachItems = (rules: SubscriptionRule[]): SubscriptionWithItems[] => {
    if (rules.length === 0) {
      return []
    }
    const ids = rules.map((rule) => rule.id)
    const rows = db
      .select()
      .from(subscriptionItemsTable)
      .where(inArray(subscriptionItemsTable.subscriptionId, ids))
      .orderBy(desc(subscriptionItemsTable.publishedAt))
      .all()
    const grouped = new Map<string, SubscriptionFeedItem[]>()
    for (const row of rows) {
      const item = rowToFeedItem(row)
      const list = grouped.get(row.subscriptionId)
      if (list) {
        list.push(item)
      } else {
        grouped.set(row.subscriptionId, [item])
      }
    }
    return rules.map((rule) => ({ ...rule, items: grouped.get(rule.id) ?? [] }))
  }

  return {
    async list() {
      const rows = db
        .select()
        .from(subscriptionsTable)
        .orderBy(desc(subscriptionsTable.updatedAt))
        .all()
      return attachItems(rows.map(rowToSubscription))
    },

    async get(id) {
      const row = db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id)).get()
      if (!row) {
        return null
      }
      return attachItems([rowToSubscription(row)])[0] ?? null
    },

    async findDuplicateFeed(feedUrl, ignoreId) {
      const target = buildFeedKey(feedUrl)
      if (!target) {
        return null
      }
      const rows = db
        .select({ id: subscriptionsTable.id, feedUrl: subscriptionsTable.feedUrl })
        .from(subscriptionsTable)
        .all()
      const hit = rows.find((row) => row.id !== ignoreId && buildFeedKey(row.feedUrl) === target)
      return hit?.id ?? null
    },

    async add(input) {
      const ts = now()
      const rule: SubscriptionRule = {
        id: generateId(),
        title: input.title?.trim() || input.sourceUrl,
        sourceUrl: input.sourceUrl,
        feedUrl: input.feedUrl,
        platform: input.platform,
        keywords: sanitizeList(input.keywords),
        tags: sanitizeList(input.tags),
        onlyDownloadLatest: input.onlyDownloadLatest ?? true,
        autoDownload: input.autoDownload ?? true,
        enabled: input.enabled ?? true,
        status: 'idle',
        createdAt: ts,
        updatedAt: ts
      }
      if (input.downloadDirectory) {
        rule.downloadDirectory = input.downloadDirectory
      }
      if (input.namingTemplate) {
        rule.namingTemplate = input.namingTemplate
      }
      db.insert(subscriptionsTable).values(subscriptionToInsert(rule, ts)).run()
      return { ...rule, items: [] }
    },

    async update(id, patch) {
      const existingRow = db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.id, id))
        .get()
      if (!existingRow) {
        return null
      }
      const existing = rowToSubscription(existingRow)
      const next: SubscriptionRule = {
        ...existing,
        ...patch,
        keywords: patch.keywords ? sanitizeList(patch.keywords) : existing.keywords,
        tags: patch.tags ? sanitizeList(patch.tags) : existing.tags,
        updatedAt: now()
      }
      if (patch.sourceUrl && !patch.title && patch.sourceUrl !== existing.sourceUrl) {
        next.title = patch.sourceUrl
      }
      const payload = subscriptionToInsert(next, next.updatedAt)
      db.insert(subscriptionsTable)
        .values(payload)
        .onConflictDoUpdate({ target: subscriptionsTable.id, set: payload })
        .run()
      return attachItems([next])[0] ?? null
    },

    async remove(id) {
      const result = db.delete(subscriptionsTable).where(eq(subscriptionsTable.id, id)).run()
      if ((result.changes ?? 0) === 0) {
        return false
      }
      db.delete(subscriptionItemsTable).where(eq(subscriptionItemsTable.subscriptionId, id)).run()
      return true
    },

    async replaceItems(subscriptionId, items) {
      const ts = now()
      db.transaction((tx) => {
        const existing = tx
          .select()
          .from(subscriptionItemsTable)
          .where(eq(subscriptionItemsTable.subscriptionId, subscriptionId))
          .all()
        const previous = new Map(existing.map((row) => [row.itemId, row]))
        tx.delete(subscriptionItemsTable)
          .where(eq(subscriptionItemsTable.subscriptionId, subscriptionId))
          .run()
        for (const item of items) {
          const prev = previous.get(item.id)
          const insert: SubscriptionItemInsert = {
            subscriptionId,
            itemId: item.id,
            title: item.title,
            url: item.url,
            publishedAt: item.publishedAt,
            added: prev?.added ?? 0,
            createdAt: prev?.createdAt ?? item.publishedAt,
            updatedAt: ts
          }
          if (item.thumbnail) {
            insert.thumbnail = item.thumbnail
          }
          if (prev?.taskId) {
            insert.taskId = prev.taskId
          }
          tx.insert(subscriptionItemsTable).values(insert).run()
        }
      })
    },

    async markItemQueued(subscriptionId, itemId, taskId) {
      const ts = now()
      const set: Partial<SubscriptionItemInsert> = {
        added: taskId ? 1 : 0,
        taskId: taskId ?? null,
        updatedAt: ts
      }
      const result = db
        .update(subscriptionItemsTable)
        .set(set)
        .where(
          and(
            eq(subscriptionItemsTable.subscriptionId, subscriptionId),
            eq(subscriptionItemsTable.itemId, itemId)
          )
        )
        .run()
      if ((result.changes ?? 0) === 0) {
        // Row may not exist yet (e.g. user-initiated queue before feed parse);
        // do a best-effort upsert with placeholder fields.
        const insert: SubscriptionItemInsert = {
          subscriptionId,
          itemId,
          title: itemId,
          url: '',
          publishedAt: ts,
          added: taskId ? 1 : 0,
          taskId: taskId ?? null,
          createdAt: ts,
          updatedAt: ts
        }
        db.insert(subscriptionItemsTable)
          .values(insert)
          .onConflictDoUpdate({
            target: [subscriptionItemsTable.subscriptionId, subscriptionItemsTable.itemId],
            set
          })
          .run()
      }
    },

    async clearQueueLinks(selector) {
      return clearQueueLinkRows(db, now(), uniqueIds(selector.taskIds), selector.items ?? [])
    },

    async clearOrphanedQueueLinks(isLive) {
      const rows = db
        .select({
          subscriptionId: subscriptionItemsTable.subscriptionId,
          itemId: subscriptionItemsTable.itemId,
          taskId: subscriptionItemsTable.taskId,
          added: subscriptionItemsTable.added
        })
        .from(subscriptionItemsTable)
        .where(or(eq(subscriptionItemsTable.added, 1), isNotNull(subscriptionItemsTable.taskId)))
        .all()
      const taskIds: string[] = []
      const items: { subscriptionId: string; itemId: string }[] = []
      const seenTasks = new Set<string>()
      const liveByTaskId = new Map<string, boolean>()
      for (const row of rows) {
        if (row.taskId) {
          let live = liveByTaskId.get(row.taskId)
          if (live === undefined) {
            live = await isLive(row.taskId)
            liveByTaskId.set(row.taskId, live)
          }
          if (live || seenTasks.has(row.taskId)) {
            continue
          }
          seenTasks.add(row.taskId)
          taskIds.push(row.taskId)
          continue
        }
        if (row.added === 1) {
          items.push({ subscriptionId: row.subscriptionId, itemId: row.itemId })
        }
      }
      return clearQueueLinkRows(db, now(), taskIds, items)
    }
  }
}

const LEADER_KEYS = {
  kind: 'leader_kind',
  pid: 'leader_pid',
  startedAt: 'leader_started_at',
  heartbeatAt: 'leader_heartbeat_at',
  lockExpiresAt: 'leader_lock_expires_at',
  leaseId: 'leader_lease_id',
  preferred: 'preferred_leader'
} as const

const readMetaMap = (db: BetterSQLite3Database): Map<string, string> => {
  const rows = db.select().from(subscriptionsMetaTable).all()
  const map = new Map<string, string>()
  for (const row of rows) {
    map.set(row.key, row.value)
  }
  return map
}

const numOrNull = (raw: string | undefined): number | null => {
  if (raw === undefined) {
    return null
  }
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

const strOrNull = (raw: string | undefined): string | null => raw ?? null

const leaderKindOrNull = (raw: string | undefined): LeaderKind | null => {
  if (raw === 'desktop' || raw === 'api') {
    return raw
  }
  return null
}

export const createSqliteMetaStore = ({
  db,
  now = () => Date.now()
}: CreateSqliteStoresOptions): MetaStore => {
  const writeKey = (key: string, value: string | number | null, at: number): void => {
    if (value === null) {
      db.delete(subscriptionsMetaTable).where(eq(subscriptionsMetaTable.key, key)).run()
      return
    }
    db.insert(subscriptionsMetaTable)
      .values({ key, value: String(value), updatedAt: at })
      .onConflictDoUpdate({
        target: subscriptionsMetaTable.key,
        set: { value: String(value), updatedAt: at }
      })
      .run()
  }

  return {
    async readLeader() {
      const map = readMetaMap(db)
      return {
        kind: leaderKindOrNull(map.get(LEADER_KEYS.kind)),
        pid: numOrNull(map.get(LEADER_KEYS.pid)),
        startedAt: numOrNull(map.get(LEADER_KEYS.startedAt)),
        heartbeatAt: numOrNull(map.get(LEADER_KEYS.heartbeatAt)),
        lockExpiresAt: numOrNull(map.get(LEADER_KEYS.lockExpiresAt)),
        leaseId: strOrNull(map.get(LEADER_KEYS.leaseId)),
        preferred: leaderKindOrNull(map.get(LEADER_KEYS.preferred))
      }
    },

    async casLeader({ expectedLeaseId, now: ts, next }) {
      let success = false
      db.transaction((tx) => {
        const rows = tx.select().from(subscriptionsMetaTable).all()
        const map = new Map<string, string>(rows.map((row) => [row.key, row.value]))
        const currentLease = map.get(LEADER_KEYS.leaseId) ?? null
        const lockExpiresAt = numOrNull(map.get(LEADER_KEYS.lockExpiresAt))

        const okToWrite =
          expectedLeaseId === null
            ? currentLease === null || (lockExpiresAt !== null && lockExpiresAt <= ts)
            : currentLease === expectedLeaseId

        if (!okToWrite) {
          return
        }

        const writeKeyTx = (key: string, value: string | number | null): void => {
          if (value === null) {
            tx.delete(subscriptionsMetaTable).where(eq(subscriptionsMetaTable.key, key)).run()
            return
          }
          tx.insert(subscriptionsMetaTable)
            .values({ key, value: String(value), updatedAt: ts })
            .onConflictDoUpdate({
              target: subscriptionsMetaTable.key,
              set: { value: String(value), updatedAt: ts }
            })
            .run()
        }

        writeKeyTx(LEADER_KEYS.kind, next.kind)
        writeKeyTx(LEADER_KEYS.pid, next.pid)
        writeKeyTx(LEADER_KEYS.startedAt, next.startedAt)
        writeKeyTx(LEADER_KEYS.heartbeatAt, next.heartbeatAt)
        writeKeyTx(LEADER_KEYS.lockExpiresAt, next.lockExpiresAt)
        writeKeyTx(LEADER_KEYS.leaseId, next.leaseId)
        success = true
      })
      return success
    },

    async readPreferred() {
      const map = readMetaMap(db)
      return leaderKindOrNull(map.get(LEADER_KEYS.preferred))
    },

    async writePreferred(kind) {
      writeKey(LEADER_KEYS.preferred, kind, now())
    }
  }
}

/**
 * In-memory MetaStore for CLI's `--vidbee-local` mode (where
 * leader election is a no-op since no other process can compete).
 */
export class InMemoryMetaStore implements MetaStore {
  private state: LeaderState = {
    kind: null,
    pid: null,
    startedAt: null,
    heartbeatAt: null,
    lockExpiresAt: null,
    leaseId: null,
    preferred: null
  }

  async readLeader(): Promise<LeaderState> {
    return { ...this.state }
  }

  async casLeader({
    expectedLeaseId,
    now,
    next
  }: {
    expectedLeaseId: string | null
    now: number
    next: Pick<
      LeaderState,
      'kind' | 'pid' | 'startedAt' | 'heartbeatAt' | 'lockExpiresAt' | 'leaseId'
    >
  }): Promise<boolean> {
    const okToWrite =
      expectedLeaseId === null
        ? this.state.leaseId === null ||
          (this.state.lockExpiresAt !== null && this.state.lockExpiresAt <= now)
        : this.state.leaseId === expectedLeaseId
    if (!okToWrite) {
      return false
    }
    this.state = { ...this.state, ...next }
    return true
  }

  async readPreferred(): Promise<LeaderKind | null> {
    return this.state.preferred
  }

  async writePreferred(kind: LeaderKind | null): Promise<void> {
    this.state = { ...this.state, preferred: kind }
  }
}
