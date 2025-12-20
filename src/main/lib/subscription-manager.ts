import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import type { Database as BetterSqlite3Instance } from 'better-sqlite3'
import DatabaseConstructor from 'better-sqlite3'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import log from 'electron-log/main'
import type {
  SubscriptionCreatePayload,
  SubscriptionFeedItem,
  SubscriptionRule,
  SubscriptionStatus,
  SubscriptionUpdatePayload
} from '../../shared/types'
import { sanitizeFilenameTemplate } from '../download-engine/args-builder'
import { runMigrations } from './database/migrate'
import {
  type SubscriptionInsert,
  type SubscriptionItemRow,
  type SubscriptionRow,
  subscriptionItemsTable,
  subscriptionsTable
} from './database/schema'
import { getDatabaseFilePath } from './database-path'

const sanitizeList = (values?: string[]): string[] => {
  if (!values || values.length === 0) {
    return []
  }
  return values
    .map((value) => value.trim())
    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index)
}

const ensureDirectoryExists = (dir?: string): void => {
  if (!dir) {
    return
  }
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (error) {
    log.error('Failed to ensure subscription directory:', error)
  }
}

const booleanToNumber = (value: boolean): number => (value ? 1 : 0)
const numberToBoolean = (value: number | null | undefined): boolean => value === 1

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

export class SubscriptionManager extends EventEmitter {
  private sqlite: BetterSqlite3Instance | null = null
  private db: BetterSQLite3Database | null = null

  constructor() {
    super()
    try {
      this.getDatabase()
      this.migrateLegacyStore()
    } catch (error) {
      log.error('subscriptions: failed to initialize database', error)
    }
  }

  getAll(): SubscriptionRule[] {
    const database = this.getDatabase()
    const rows = database
      .select()
      .from(subscriptionsTable)
      .orderBy(desc(subscriptionsTable.updatedAt))
      .all()
    return this.attachFeedItems(rows.map((row) => this.mapRowToRecord(row)))
  }

  getById(id: string): SubscriptionRule | undefined {
    const database = this.getDatabase()
    const row = database
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, id))
      .get()
    if (!row) {
      return undefined
    }
    return this.attachFeedItems([this.mapRowToRecord(row)])[0]
  }

  add(payload: SubscriptionCreatePayload): SubscriptionRule {
    const timestamp = Date.now()
    const keywords = sanitizeList(payload.keywords)
    const tags = sanitizeList(payload.tags)
    const record: SubscriptionRule = {
      id: randomUUID(),
      title: payload.sourceUrl,
      sourceUrl: payload.sourceUrl,
      feedUrl: payload.feedUrl,
      platform: payload.platform,
      keywords,
      tags,
      onlyDownloadLatest: payload.onlyDownloadLatest ?? true,
      enabled: payload.enabled ?? true,
      coverUrl: undefined,
      latestVideoTitle: undefined,
      latestVideoPublishedAt: undefined,
      lastCheckedAt: undefined,
      lastSuccessAt: undefined,
      status: 'idle',
      lastError: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
      downloadDirectory: payload.downloadDirectory,
      namingTemplate: payload.namingTemplate
        ? sanitizeFilenameTemplate(payload.namingTemplate)
        : undefined,
      items: []
    }

    ensureDirectoryExists(payload.downloadDirectory)
    this.insertRecord(record)
    this.emitUpdates()
    return record
  }

  update(
    id: string,
    updates: SubscriptionUpdatePayload & Partial<SubscriptionRule>
  ): SubscriptionRule | undefined {
    const existing = this.getById(id)
    if (!existing) {
      return undefined
    }

    const keywords = updates.keywords ? sanitizeList(updates.keywords) : undefined
    const tags = updates.tags ? sanitizeList(updates.tags) : undefined
    const next: SubscriptionRule = {
      ...existing,
      ...updates,
      keywords: keywords ?? existing.keywords,
      tags: tags ?? existing.tags,
      updatedAt: Date.now()
    }

    // If sourceUrl is updated but title is not explicitly set, update title to match sourceUrl
    if (updates.sourceUrl && !updates.title && updates.sourceUrl !== existing.sourceUrl) {
      next.title = updates.sourceUrl
    }

    if (updates.namingTemplate) {
      next.namingTemplate = sanitizeFilenameTemplate(updates.namingTemplate)
    }

    ensureDirectoryExists(next.downloadDirectory)
    this.updateRecord(next)
    this.emitUpdates()
    return next
  }

  remove(id: string): boolean {
    const database = this.getDatabase()
    const result = database.delete(subscriptionsTable).where(eq(subscriptionsTable.id, id)).run()
    if ((result.changes ?? 0) > 0) {
      database
        .delete(subscriptionItemsTable)
        .where(eq(subscriptionItemsTable.subscriptionId, id))
        .run()
      this.emitUpdates()
      return true
    }
    return false
  }

  replaceFeedItems(
    subscriptionId: string,
    items: SubscriptionFeedItem[],
    silent: boolean = false
  ): void {
    const database = this.getDatabase()
    const orderedItems = [...items].sort((a, b) => b.publishedAt - a.publishedAt)
    const now = Date.now()
    database.transaction((tx) => {
      tx.delete(subscriptionItemsTable)
        .where(eq(subscriptionItemsTable.subscriptionId, subscriptionId))
        .run()
      for (const item of orderedItems) {
        tx.insert(subscriptionItemsTable)
          .values({
            subscriptionId,
            itemId: item.id,
            title: item.title,
            url: item.url,
            publishedAt: item.publishedAt,
            thumbnail: item.thumbnail ?? null,
            added: booleanToNumber(item.addedToQueue),
            downloadId: item.downloadId ?? null,
            createdAt: item.publishedAt,
            updatedAt: now
          })
          .run()
      }
    })
    if (!silent) {
      this.emitUpdates()
    }
  }

  updateFeedItemQueueState(
    subscriptionId: string,
    itemId: string,
    updates: { added?: boolean; downloadId?: string | null }
  ): void {
    if (updates.added === undefined && !Object.hasOwn(updates, 'downloadId')) {
      return
    }

    const setPayload: Partial<typeof subscriptionItemsTable.$inferInsert> = {
      updatedAt: Date.now()
    }

    if (updates.added !== undefined) {
      setPayload.added = booleanToNumber(updates.added)
    }
    if (Object.hasOwn(updates, 'downloadId')) {
      setPayload.downloadId = updates.downloadId ?? null
    }

    const database = this.getDatabase()
    const result = database
      .update(subscriptionItemsTable)
      .set(setPayload)
      .where(
        and(
          eq(subscriptionItemsTable.subscriptionId, subscriptionId),
          eq(subscriptionItemsTable.itemId, itemId)
        )
      )
      .run()

    if ((result.changes ?? 0) > 0) {
      this.emitUpdates()
    }
  }

  private attachFeedItems(records: SubscriptionRule[]): SubscriptionRule[] {
    if (records.length === 0) {
      return records
    }
    const ids = records.map((record) => record.id)
    const database = this.getDatabase()
    const rows = database
      .select()
      .from(subscriptionItemsTable)
      .where(inArray(subscriptionItemsTable.subscriptionId, ids))
      .orderBy(desc(subscriptionItemsTable.publishedAt))
      .all()

    const grouped = new Map<string, SubscriptionFeedItem[]>()
    for (const row of rows) {
      const item = this.mapItemRowToFeedItem(row)
      const list = grouped.get(row.subscriptionId)
      if (list) {
        list.push(item)
      } else {
        grouped.set(row.subscriptionId, [item])
      }
    }

    return records.map((record) => ({
      ...record,
      items: grouped.get(record.id) ?? []
    }))
  }

  private getDatabase(): BetterSQLite3Database {
    if (this.db) {
      return this.db
    }

    const databasePath = this.getDatabasePath()
    this.sqlite = new DatabaseConstructor(databasePath, { timeout: 5000 })
    this.sqlite.pragma('journal_mode = WAL')
    this.sqlite.pragma('foreign_keys = ON')
    this.db = drizzle(this.sqlite)
    runMigrations(this.db)
    this.ensureSubscriptionsSchema()
    this.ensureItemsSchema()
    log.info('subscriptions: database initialized at', databasePath)
    return this.db
  }

  private ensureItemsSchema(): void {
    if (!this.sqlite) {
      return
    }
    try {
      const columns = this.sqlite.prepare(`PRAGMA table_info(subscription_items)`).all() as Array<{
        name: string
      }>
      const hasAdded = columns.some((column) => column.name === 'added')
      if (!hasAdded) {
        this.sqlite
          .prepare(`ALTER TABLE subscription_items ADD COLUMN added INTEGER NOT NULL DEFAULT 0`)
          .run()
      }
      const hasDownloaded = columns.some((column) => column.name === 'downloaded')
      const hasLegacyStatus = columns.some((column) => column.name === 'status')
      const needsMigration = hasDownloaded || hasLegacyStatus
      if (needsMigration) {
        if (hasDownloaded) {
          this.sqlite.prepare(`UPDATE subscription_items SET added = 1 WHERE downloaded = 1`).run()
        }
        const sqlite = this.sqlite
        const migrate = sqlite.transaction(() => {
          sqlite.prepare(`DROP TABLE IF EXISTS subscription_items_new`).run()
          sqlite
            .prepare(
              `CREATE TABLE subscription_items_new (
                subscription_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                published_at INTEGER NOT NULL,
                thumbnail TEXT,
                added INTEGER NOT NULL,
                download_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (subscription_id, item_id)
              )`
            )
            .run()
          sqlite
            .prepare(
              `INSERT INTO subscription_items_new (
                subscription_id,
                item_id,
                title,
                url,
                published_at,
                thumbnail,
                added,
                download_id,
                created_at,
                updated_at
              )
              SELECT
                subscription_id,
                item_id,
                title,
                url,
                published_at,
                thumbnail,
                added,
                download_id,
                created_at,
                updated_at
              FROM subscription_items`
            )
            .run()
          sqlite.prepare(`DROP TABLE subscription_items`).run()
          sqlite.prepare(`ALTER TABLE subscription_items_new RENAME TO subscription_items`).run()
          sqlite
            .prepare(
              'CREATE INDEX IF NOT EXISTS subscription_items_subscription_idx ON subscription_items (subscription_id)'
            )
            .run()
        })
        migrate()
        log.info('subscriptions: removed legacy columns from subscription_items')
      }
    } catch (error) {
      log.warn('subscriptions: failed to ensure subscription_items schema', error)
    }
  }

  private ensureSubscriptionsSchema(): void {
    if (!this.sqlite) {
      return
    }
    try {
      const columns = this.sqlite.prepare(`PRAGMA table_info(subscriptions)`).all() as Array<{
        name: string
      }>
      const hasLegacyColumns = columns.some((column) =>
        ['seen_item_ids', 'last_item_id'].includes(column.name)
      )
      if (!hasLegacyColumns) {
        return
      }
      const sqlite = this.sqlite
      const migrate = sqlite.transaction(() => {
        sqlite.prepare(`DROP TABLE IF EXISTS subscriptions_new`).run()
        sqlite
          .prepare(
            `CREATE TABLE subscriptions_new (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              source_url TEXT NOT NULL,
              feed_url TEXT NOT NULL,
              platform TEXT NOT NULL,
              keywords TEXT NOT NULL,
              tags TEXT NOT NULL,
              only_latest INTEGER NOT NULL,
              enabled INTEGER NOT NULL,
              cover_url TEXT,
              latest_video_title TEXT,
              latest_video_published_at INTEGER,
              last_checked_at INTEGER,
              last_success_at INTEGER,
              status TEXT NOT NULL,
              last_error TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              download_directory TEXT,
              naming_template TEXT
            )`
          )
          .run()
        sqlite
          .prepare(
            `INSERT INTO subscriptions_new (
              id,
              title,
              source_url,
              feed_url,
              platform,
              keywords,
              tags,
              only_latest,
              enabled,
              cover_url,
              latest_video_title,
              latest_video_published_at,
              last_checked_at,
              last_success_at,
              status,
              last_error,
              created_at,
              updated_at,
              download_directory,
              naming_template
            )
            SELECT
              id,
              title,
              source_url,
              feed_url,
              platform,
              keywords,
              tags,
              only_latest,
              enabled,
              cover_url,
              latest_video_title,
              latest_video_published_at,
              last_checked_at,
              last_success_at,
              status,
              last_error,
              created_at,
              updated_at,
              download_directory,
              naming_template
            FROM subscriptions`
          )
          .run()
        sqlite.prepare(`DROP TABLE subscriptions`).run()
        sqlite.prepare(`ALTER TABLE subscriptions_new RENAME TO subscriptions`).run()
      })
      migrate()
      log.info('subscriptions: removed legacy seen_item_ids and last_item_id columns')
    } catch (error) {
      log.warn('subscriptions: failed to ensure subscriptions schema', error)
    }
  }

  private getDatabasePath(): string {
    return getDatabaseFilePath()
  }

  private migrateLegacyStore(): void {
    try {
      const ElectronStore = require('electron-store')
      // Access the default export
      const LegacyStore = ElectronStore.default || ElectronStore
      const store = new LegacyStore({
        name: 'subscriptions',
        defaults: {
          subscriptions: []
        }
      })
      const legacyData = store.get('subscriptions') as SubscriptionRule[] | undefined
      if (!legacyData || legacyData.length === 0) {
        return
      }

      if (this.getAll().length > 0) {
        return
      }

      for (const legacyItem of legacyData) {
        try {
          const normalized: SubscriptionRule = {
            ...legacyItem,
            keywords: sanitizeList(legacyItem.keywords),
            tags: sanitizeList(legacyItem.tags),
            items: []
          }
          this.insertRecord(normalized)
          const legacyFeedItemsRaw = Array.isArray(
            (legacyItem as { items?: SubscriptionFeedItem[] }).items
          )
            ? ((legacyItem as { items?: SubscriptionFeedItem[] }).items ?? [])
            : []
          if (legacyFeedItemsRaw.length > 0) {
            const converted = legacyFeedItemsRaw.map((item) => ({
              id: item.id,
              url: item.url,
              title: item.title,
              publishedAt: item.publishedAt,
              thumbnail: item.thumbnail,
              addedToQueue: Boolean((item as { downloaded?: boolean }).downloaded),
              downloadId: item.downloadId
            }))
            this.replaceFeedItems(normalized.id, converted, true)
          }
        } catch (error) {
          log.error('subscriptions: failed to migrate legacy record', error)
        }
      }

      store.clear()
      this.emitUpdates()
      log.info(`subscriptions: migrated ${legacyData.length} legacy entries`)
    } catch (error) {
      log.warn('subscriptions: legacy migration skipped', error)
    }
  }

  private insertRecord(record: SubscriptionRule): void {
    const database = this.getDatabase()
    const payload = this.mapRecordToInsert(record)
    database
      .insert(subscriptionsTable)
      .values(payload)
      .onConflictDoUpdate({ target: subscriptionsTable.id, set: payload })
      .run()
  }

  private updateRecord(record: SubscriptionRule): void {
    const database = this.getDatabase()
    const payload = this.mapRecordToInsert(record)
    database
      .insert(subscriptionsTable)
      .values(payload)
      .onConflictDoUpdate({ target: subscriptionsTable.id, set: payload })
      .run()
  }

  private mapRecordToInsert(record: SubscriptionRule): SubscriptionInsert {
    return {
      id: record.id,
      title: record.title,
      sourceUrl: record.sourceUrl,
      feedUrl: record.feedUrl,
      platform: record.platform,
      keywords: stringifyArray(record.keywords),
      tags: stringifyArray(record.tags),
      onlyDownloadLatest: booleanToNumber(record.onlyDownloadLatest),
      enabled: booleanToNumber(record.enabled),
      coverUrl: record.coverUrl,
      latestVideoTitle: record.latestVideoTitle,
      latestVideoPublishedAt: record.latestVideoPublishedAt ?? null,
      lastCheckedAt: record.lastCheckedAt ?? null,
      lastSuccessAt: record.lastSuccessAt ?? null,
      status: record.status,
      lastError: record.lastError,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      downloadDirectory: record.downloadDirectory,
      namingTemplate: record.namingTemplate
        ? sanitizeFilenameTemplate(record.namingTemplate)
        : undefined
    }
  }

  private mapRowToRecord(row: SubscriptionRow): SubscriptionRule {
    return {
      id: row.id,
      title: row.title,
      sourceUrl: row.sourceUrl,
      feedUrl: row.feedUrl,
      platform: row.platform as SubscriptionRule['platform'],
      keywords: parseStringArray(row.keywords),
      tags: parseStringArray(row.tags),
      onlyDownloadLatest: numberToBoolean(row.onlyDownloadLatest),
      enabled: numberToBoolean(row.enabled),
      coverUrl: row.coverUrl ?? undefined,
      latestVideoTitle: row.latestVideoTitle ?? undefined,
      latestVideoPublishedAt: row.latestVideoPublishedAt ?? undefined,
      lastCheckedAt: row.lastCheckedAt ?? undefined,
      lastSuccessAt: row.lastSuccessAt ?? undefined,
      status: row.status as SubscriptionStatus,
      lastError: row.lastError ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      downloadDirectory: row.downloadDirectory ?? undefined,
      namingTemplate: row.namingTemplate ? sanitizeFilenameTemplate(row.namingTemplate) : undefined,
      items: []
    }
  }

  private mapItemRowToFeedItem(row: SubscriptionItemRow): SubscriptionFeedItem {
    return {
      id: row.itemId,
      url: row.url,
      title: row.title,
      publishedAt: row.publishedAt,
      thumbnail: row.thumbnail ?? undefined,
      addedToQueue: numberToBoolean(row.added),
      downloadId: row.downloadId ?? undefined
    }
  }

  private emitUpdates(): void {
    this.emit('subscriptions:updated', this.getAll())
  }
}

export const subscriptionManager = new SubscriptionManager()
