import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { Database as BetterSqlite3Instance } from 'better-sqlite3'
import DatabaseConstructor from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { app } from 'electron'
import log from 'electron-log/main'
import type { DownloadHistoryItem } from '../../shared/types'

const logger = log.scope('history-manager')

const downloadHistoryTable = sqliteTable('download_history', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  downloadedAt: integer('downloaded_at', { mode: 'number' }).notNull(),
  completedAt: integer('completed_at', { mode: 'number' }),
  sortKey: integer('sort_key', { mode: 'number' }).notNull(),
  payload: text('payload').notNull()
})

type DownloadHistoryRow = typeof downloadHistoryTable.$inferSelect
type DownloadHistoryInsert = typeof downloadHistoryTable.$inferInsert

class HistoryManager {
  private sqlite: BetterSqlite3Instance | null = null
  private db: BetterSQLite3Database | null = null
  private history: Map<string, DownloadHistoryItem> = new Map()
  private migrationChecked = false

  constructor() {
    this.initialize()
  }

  private initialize(): void {
    try {
      this.getDatabase()
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

    this.sqlite = new DatabaseConstructor(databasePath, { timeout: 5000 })
    this.sqlite.pragma('journal_mode = WAL')
    this.sqlite.pragma('foreign_keys = ON')
    this.sqlite
      .prepare(
        `CREATE TABLE IF NOT EXISTS download_history (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          downloaded_at INTEGER NOT NULL,
          completed_at INTEGER,
          sort_key INTEGER NOT NULL,
          payload TEXT NOT NULL
        )`
      )
      .run()

    this.db = drizzle(this.sqlite)
    logger.info(`history-db initialized at ${databasePath}`)
    return this.db
  }

  private getDatabasePath(): string {
    return join(app.getPath('userData'), 'download-history.sqlite')
  }

  private getLegacyStorePath(): string {
    return join(app.getPath('userData'), 'download-history.json')
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
      status: item.status,
      downloadedAt: item.downloadedAt,
      completedAt: item.completedAt ?? null,
      sortKey: item.completedAt ?? item.downloadedAt,
      payload: JSON.stringify(item)
    }
  }

  private mapItemToUpdate(payload: DownloadHistoryInsert): Omit<DownloadHistoryInsert, 'id'> {
    const { id: _id, ...rest } = payload
    return rest
  }

  private mapRowToItem(row: DownloadHistoryRow): DownloadHistoryItem {
    try {
      const parsed = JSON.parse(row.payload) as DownloadHistoryItem
      return {
        ...parsed,
        status: row.status as DownloadHistoryItem['status'],
        downloadedAt: row.downloadedAt,
        completedAt: row.completedAt ?? undefined
      }
    } catch (error) {
      logger.error('history-db failed to parse stored payload', { id: row.id, error })
      return {
        id: row.id,
        url: '',
        title: 'Unknown download',
        type: 'video',
        status: row.status as DownloadHistoryItem['status'],
        downloadedAt: row.downloadedAt,
        completedAt: row.completedAt ?? undefined
      }
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
