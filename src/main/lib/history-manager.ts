import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import DatabaseConstructor from 'better-sqlite3'
import { eq, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { app } from 'electron'
import log from 'electron-log/main'
import type { DownloadHistoryItem } from '../../shared/types'
import { runMigrations } from './database/migrate'
import {
  type DownloadHistoryInsert,
  type DownloadHistoryRow,
  downloadHistoryTable
} from './database/schema'
import { getDatabaseFilePath } from './database-path'

const logger = log.scope('history-manager')

const TAG_SEPARATOR = '\n'

const createDownloadHistoryTableSql = sql`
  CREATE TABLE IF NOT EXISTS download_history (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    thumbnail TEXT,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    download_path TEXT,
    saved_file_name TEXT,
    file_size INTEGER,
    duration INTEGER,
    downloaded_at INTEGER NOT NULL,
    completed_at INTEGER,
    sort_key INTEGER NOT NULL,
    error TEXT,
    description TEXT,
    channel TEXT,
    uploader TEXT,
    view_count INTEGER,
    tags TEXT,
    origin TEXT,
    subscription_id TEXT,
    selected_format TEXT,
    playlist_id TEXT,
    playlist_title TEXT,
    playlist_index INTEGER,
    playlist_size INTEGER
  )
`

const renameDownloadHistoryTableSql = sql`
  ALTER TABLE download_history RENAME TO download_history_legacy
`

const dropLegacyDownloadHistoryTableSql = sql`
  DROP TABLE download_history_legacy
`

const copyDownloadHistoryFromLegacySql = sql`
  INSERT INTO download_history (
    id,
    url,
    title,
    thumbnail,
    type,
    status,
    download_path,
    saved_file_name,
    file_size,
    duration,
    downloaded_at,
    completed_at,
    sort_key,
    error,
    description,
    channel,
    uploader,
    view_count,
    tags,
    origin,
    subscription_id,
    selected_format,
    playlist_id,
    playlist_title,
    playlist_index,
    playlist_size
  )
  SELECT
    id,
    url,
    title,
    thumbnail,
    type,
    status,
    download_path,
    saved_file_name,
    file_size,
    duration,
    downloaded_at,
    completed_at,
    sort_key,
    error,
    description,
    channel,
    uploader,
    view_count,
    tags,
    origin,
    subscription_id,
    selected_format,
    playlist_id,
    playlist_title,
    playlist_index,
    playlist_size
  FROM download_history_legacy
`

const sanitizeList = (values?: string[]): string[] => {
  if (!values || values.length === 0) {
    return []
  }
  return values
    .map((value) => value.trim())
    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index)
}

const serializeTags = (values?: string[]): string | null => {
  const sanitized = sanitizeList(values)
  return sanitized.length > 0 ? sanitized.join(TAG_SEPARATOR) : null
}

const parseTags = (value: string | null): string[] | undefined => {
  if (!value) {
    return undefined
  }
  const parsed = value
    .split(TAG_SEPARATOR)
    .map((tag) => tag.trim())
    .filter((tag, index, array) => tag.length > 0 && array.indexOf(tag) === index)
  return parsed.length > 0 ? parsed : undefined
}

const legacyDownloadHistoryTable = sqliteTable('download_history_legacy', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  downloadedAt: integer('downloaded_at', { mode: 'number' }).notNull(),
  completedAt: integer('completed_at', { mode: 'number' }),
  sortKey: integer('sort_key', { mode: 'number' }).notNull(),
  payload: text('payload').notNull()
})
type LegacyDownloadHistoryRow = typeof legacyDownloadHistoryTable.$inferSelect

class HistoryManager {
  private db: BetterSQLite3Database | null = null
  private history: Map<string, DownloadHistoryItem> = new Map()
  private schemaChecked = false
  private migrationChecked = false

  constructor() {
    this.initialize()
  }

  private initialize(): void {
    try {
      this.getDatabase()
      this.ensureStructuredSchema()
      this.ensureLegacyMigration()
      this.loadHistoryFromDatabase()
    } catch (error) {
      logger.error('history-db failed to initialize', error)
    }
  }

  private getDatabase(): BetterSQLite3Database {
    if (this.db) {
      return this.db
    }

    const databasePath = this.getDatabasePath()

    const sqlite = new DatabaseConstructor(databasePath, { timeout: 5000 })
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')

    const database = drizzle(sqlite)
    runMigrations(database)

    this.db = database
    logger.info(`history-db initialized at ${databasePath}`)
    return this.db
  }

  private getDatabasePath(): string {
    return getDatabaseFilePath()
  }

  private getLegacyStorePath(): string {
    return join(app.getPath('userData'), 'download-history.json')
  }

  private ensureStructuredSchema(): void {
    if (this.schemaChecked) {
      return
    }
    this.schemaChecked = true

    try {
      const database = this.getDatabase()
      const columns = database.all<{ name: string }>(sql`PRAGMA table_info(download_history)`)
      const hasPayloadColumn = columns.some((column) => column.name === 'payload')
      const hasUrlColumn = columns.some((column) => column.name === 'url')
      if (hasPayloadColumn || !hasUrlColumn) {
        this.migrateLegacyPayloadTable()
        return
      }

      const deprecatedColumns = ['subscription_title', 'format', 'quality', 'codec']
      const needsRebuild = columns.some((column) => deprecatedColumns.includes(column.name))
      if (needsRebuild) {
        this.rebuildDownloadHistoryTable()
      }
    } catch (error) {
      logger.error('history-db failed to inspect schema', error)
    }
  }

  private migrateLegacyPayloadTable(): void {
    const database = this.getDatabase()
    logger.info('history-db migrating legacy payload schema to structured columns')

    try {
      let migratedCount = 0
      database.transaction(
        (tx) => {
          tx.run(renameDownloadHistoryTableSql)
          tx.run(createDownloadHistoryTableSql)

          const legacyRows = tx.select().from(legacyDownloadHistoryTable).all()
          migratedCount = legacyRows.length
          for (const legacyRow of legacyRows) {
            const normalized = this.normalizeItem(this.mapLegacyRowToItem(legacyRow))
            tx.insert(downloadHistoryTable).values(this.mapItemToInsert(normalized)).run()
          }

          tx.run(dropLegacyDownloadHistoryTableSql)
        },
        { behavior: 'immediate' }
      )
      logger.info(`history-db migrated ${migratedCount} rows to new schema`)
    } catch (error) {
      logger.error('history-db failed to migrate legacy payload rows', error)
      throw error
    }
  }

  private rebuildDownloadHistoryTable(): void {
    const database = this.getDatabase()
    logger.info('history-db rebuilding download_history table to latest schema')

    try {
      database.transaction(
        (tx) => {
          tx.run(renameDownloadHistoryTableSql)
          tx.run(createDownloadHistoryTableSql)
          tx.run(copyDownloadHistoryFromLegacySql)
          tx.run(dropLegacyDownloadHistoryTableSql)
        },
        { behavior: 'immediate' }
      )
      logger.info('history-db rebuilt download_history table')
    } catch (error) {
      logger.error('history-db failed to rebuild download_history schema', error)
      throw error
    }
  }

  private mapLegacyRowToItem(row: LegacyDownloadHistoryRow): DownloadHistoryItem {
    try {
      const parsed = JSON.parse(row.payload) as DownloadHistoryItem
      return {
        ...parsed,
        status: (parsed.status ?? row.status) as DownloadHistoryItem['status'],
        downloadedAt: parsed.downloadedAt ?? row.downloadedAt,
        completedAt: parsed.completedAt ?? row.completedAt ?? undefined
      }
    } catch (error) {
      logger.warn('history-db falling back while migrating payload row', { id: row.id, error })
      return {
        id: row.id,
        url: row.id,
        title: `Download ${row.id}`,
        type: 'video',
        status: row.status as DownloadHistoryItem['status'],
        downloadedAt: row.downloadedAt,
        completedAt: row.completedAt ?? undefined
      }
    }
  }

  private ensureLegacyMigration(): void {
    if (this.migrationChecked) {
      return
    }
    this.migrationChecked = true

    const legacyPath = this.getLegacyStorePath()
    if (!existsSync(legacyPath)) {
      return
    }

    try {
      const raw = readFileSync(legacyPath, 'utf-8')
      const parsed = JSON.parse(raw) as { items?: DownloadHistoryItem[] }
      const items = parsed.items ?? []
      if (items.length === 0) {
        return
      }

      const database = this.getDatabase()
      for (const legacyItem of items) {
        const normalized = this.normalizeItem(legacyItem)
        const insertPayload = this.mapItemToInsert(normalized)
        database
          .insert(downloadHistoryTable)
          .values(insertPayload)
          .onConflictDoUpdate({
            target: downloadHistoryTable.id,
            set: this.mapItemToUpdate(insertPayload)
          })
          .run()
      }

      try {
        renameSync(legacyPath, `${legacyPath}.bak`)
      } catch (renameError) {
        logger.warn(
          'history-db migrated legacy store but could not rename original file',
          renameError
        )
      }

      logger.info(`history-db migrated ${items.length} entries from legacy electron-store data`)
    } catch (error) {
      logger.error('history-db failed to migrate legacy store', error)
    }
  }

  private loadHistoryFromDatabase(): void {
    try {
      const database = this.getDatabase()
      const rows = database.select().from(downloadHistoryTable).all()
      this.history = new Map(rows.map((row) => [row.id, this.mapRowToItem(row)]))
    } catch (error) {
      logger.error('history-db failed to load rows', error)
      this.history = new Map()
    }
  }

  private normalizeItem(item: DownloadHistoryItem): DownloadHistoryItem {
    const fallbackTimestamp = Date.now()
    const downloadedAt = item.downloadedAt ?? item.completedAt ?? fallbackTimestamp
    const status = item.status ?? 'pending'

    return {
      ...item,
      status,
      downloadedAt
    }
  }

  private mapItemToInsert(item: DownloadHistoryItem): DownloadHistoryInsert {
    return {
      id: item.id,
      url: item.url,
      title: item.title,
      thumbnail: item.thumbnail ?? null,
      type: item.type,
      status: item.status,
      downloadPath: item.downloadPath ?? null,
      savedFileName: item.savedFileName ?? null,
      fileSize: item.fileSize ?? null,
      duration: item.duration ?? null,
      downloadedAt: item.downloadedAt,
      completedAt: item.completedAt ?? null,
      sortKey: item.completedAt ?? item.downloadedAt,
      error: item.error ?? null,
      description: item.description ?? null,
      channel: item.channel ?? null,
      uploader: item.uploader ?? null,
      viewCount: item.viewCount ?? null,
      tags: serializeTags(item.tags) ?? null,
      origin: item.origin ?? null,
      subscriptionId: item.subscriptionId ?? null,
      selectedFormat: item.selectedFormat ? JSON.stringify(item.selectedFormat) : null,
      playlistId: item.playlistId ?? null,
      playlistTitle: item.playlistTitle ?? null,
      playlistIndex: item.playlistIndex ?? null,
      playlistSize: item.playlistSize ?? null
    }
  }

  private mapItemToUpdate(payload: DownloadHistoryInsert): Omit<DownloadHistoryInsert, 'id'> {
    const { id: _id, ...rest } = payload
    return rest
  }

  private mapRowToItem(row: DownloadHistoryRow): DownloadHistoryItem {
    let selectedFormat: DownloadHistoryItem['selectedFormat']
    if (row.selectedFormat) {
      try {
        selectedFormat = JSON.parse(row.selectedFormat) as DownloadHistoryItem['selectedFormat']
      } catch (error) {
        logger.warn('history-db failed to parse stored selectedFormat', { id: row.id, error })
      }
    }

    const tags = parseTags(row.tags ?? null)

    return {
      id: row.id,
      url: row.url,
      title: row.title,
      thumbnail: row.thumbnail ?? undefined,
      type: row.type as DownloadHistoryItem['type'],
      status: row.status as DownloadHistoryItem['status'],
      downloadPath: row.downloadPath ?? undefined,
      savedFileName: row.savedFileName ?? undefined,
      fileSize: row.fileSize ?? undefined,
      duration: row.duration ?? undefined,
      downloadedAt: row.downloadedAt,
      completedAt: row.completedAt ?? undefined,
      error: row.error ?? undefined,
      description: row.description ?? undefined,
      channel: row.channel ?? undefined,
      uploader: row.uploader ?? undefined,
      viewCount: row.viewCount ?? undefined,
      tags,
      origin: row.origin ? (row.origin as DownloadHistoryItem['origin']) : undefined,
      subscriptionId: row.subscriptionId ?? undefined,
      selectedFormat,
      playlistId: row.playlistId ?? undefined,
      playlistTitle: row.playlistTitle ?? undefined,
      playlistIndex: row.playlistIndex ?? undefined,
      playlistSize: row.playlistSize ?? undefined
    }
  }

  addHistoryItem(item: DownloadHistoryItem): void {
    const normalized = this.normalizeItem(item)
    const insertPayload = this.mapItemToInsert(normalized)
    try {
      const database = this.getDatabase()
      database
        .insert(downloadHistoryTable)
        .values(insertPayload)
        .onConflictDoUpdate({
          target: downloadHistoryTable.id,
          set: this.mapItemToUpdate(insertPayload)
        })
        .run()
      this.history.set(normalized.id, normalized)
    } catch (error) {
      logger.error('history-db failed to upsert item', { id: normalized.id, error })
    }
  }

  getHistory(): DownloadHistoryItem[] {
    return Array.from(this.history.values()).sort((a, b) => {
      const aTime = a.completedAt ?? a.downloadedAt
      const bTime = b.completedAt ?? b.downloadedAt
      return bTime - aTime
    })
  }

  getHistoryById(id: string): DownloadHistoryItem | undefined {
    return this.history.get(id)
  }

  removeHistoryItem(id: string): boolean {
    try {
      const database = this.getDatabase()
      const result = database
        .delete(downloadHistoryTable)
        .where(eq(downloadHistoryTable.id, id))
        .run()
      const removedFromMap = this.history.delete(id)
      return result.changes > 0 || removedFromMap
    } catch (error) {
      logger.error('history-db failed to delete item', { id, error })
      return false
    }
  }

  clearHistory(): void {
    try {
      const database = this.getDatabase()
      database.delete(downloadHistoryTable).run()
      this.history.clear()
    } catch (error) {
      logger.error('history-db failed to clear items', error)
    }
  }

  clearHistoryByStatus(status: DownloadHistoryItem['status']): number {
    let removedCount = 0
    try {
      const database = this.getDatabase()
      const result = database
        .delete(downloadHistoryTable)
        .where(eq(downloadHistoryTable.status, status))
        .run()
      for (const [id, item] of this.history.entries()) {
        if (item.status === status) {
          this.history.delete(id)
          removedCount++
        }
      }
      if ((result.changes ?? 0) > removedCount) {
        removedCount = result.changes ?? removedCount
      }
      return removedCount
    } catch (error) {
      logger.error('history-db failed to clear items by status', { status, error })
      return removedCount
    }
  }

  getHistoryCount(): {
    active: number
    completed: number
    error: number
    cancelled: number
    total: number
  } {
    const counts = {
      active: 0,
      completed: 0,
      error: 0,
      cancelled: 0,
      total: this.history.size
    }

    for (const item of this.history.values()) {
      if (item.status === 'completed') {
        counts.completed++
      } else if (item.status === 'error') {
        counts.error++
      } else if (item.status === 'cancelled') {
        counts.cancelled++
      } else {
        counts.active++
      }
    }

    return counts
  }

  hasHistoryForUrl(url: string): boolean {
    for (const item of this.history.values()) {
      if (item.url === url) {
        return true
      }
    }
    return false
  }
}

export const historyManager = new HistoryManager()
