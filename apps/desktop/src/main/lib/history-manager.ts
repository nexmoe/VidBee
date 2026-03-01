import { eq, inArray } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import log from 'electron-log/main'
import type { DownloadHistoryItem } from '../../shared/types'
import { getDatabaseConnection } from './database'
import {
  type DownloadHistoryInsert,
  type DownloadHistoryRow,
  downloadHistoryTable
} from './database/schema'

const logger = log.scope('history-manager')

const TAG_SEPARATOR = '\n'

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

class HistoryManager {
  private db: BetterSQLite3Database | null = null
  private history: Map<string, DownloadHistoryItem> = new Map()

  constructor() {
    this.initialize()
  }

  private initialize(): void {
    try {
      this.getDatabase()
      this.loadHistoryFromDatabase()
    } catch (error) {
      logger.error('history-db failed to initialize', error)
    }
  }

  private getDatabase(): BetterSQLite3Database {
    if (this.db) {
      return this.db
    }
    const { db } = getDatabaseConnection()
    this.db = db
    return this.db
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
      ytDlpCommand: item.ytDlpCommand ?? null,
      ytDlpLog: item.ytDlpLog ?? null,
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
      ytDlpCommand: row.ytDlpCommand ?? undefined,
      ytDlpLog: row.ytDlpLog ?? undefined,
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

  removeHistoryItems(ids: string[]): number {
    const uniqueIds = Array.from(new Set(ids)).filter((id) => id.trim().length > 0)
    if (uniqueIds.length === 0) {
      return 0
    }
    let removedCount = 0
    try {
      const database = this.getDatabase()
      const result = database
        .delete(downloadHistoryTable)
        .where(inArray(downloadHistoryTable.id, uniqueIds))
        .run()
      for (const id of uniqueIds) {
        if (this.history.delete(id)) {
          removedCount++
        }
      }
      if ((result.changes ?? 0) > removedCount) {
        removedCount = result.changes ?? removedCount
      }
      return removedCount
    } catch (error) {
      logger.error('history-db failed to delete items', { count: uniqueIds.length, error })
      return removedCount
    }
  }

  removeHistoryByPlaylistId(playlistId: string): number {
    const normalized = playlistId.trim()
    if (!normalized) {
      return 0
    }
    let removedCount = 0
    try {
      const database = this.getDatabase()
      const result = database
        .delete(downloadHistoryTable)
        .where(eq(downloadHistoryTable.playlistId, normalized))
        .run()
      for (const [id, item] of this.history.entries()) {
        if (item.playlistId === normalized) {
          this.history.delete(id)
          removedCount++
        }
      }
      if ((result.changes ?? 0) > removedCount) {
        removedCount = result.changes ?? removedCount
      }
      return removedCount
    } catch (error) {
      logger.error('history-db failed to delete playlist items', { playlistId: normalized, error })
      return removedCount
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
