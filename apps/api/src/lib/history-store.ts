import fs from 'node:fs'
import path from 'node:path'
import { downloadHistoryTable } from '@vidbee/db/history'
import type { DownloadTask } from '@vidbee/downloader-core'
import DatabaseConstructor from 'better-sqlite3'
import { desc, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { runDatabaseMigrations } from './database-migrate'
import { isTerminalTask, mapHistoryRowToTask, serializeHistoryTask } from './history-record-mapper'

export class HistoryStore {
  private readonly db
  private readonly sqlite

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    this.sqlite = new DatabaseConstructor(databasePath, { timeout: 5000 })
    this.sqlite.pragma('journal_mode = WAL')
    this.db = drizzle(this.sqlite)
    runDatabaseMigrations(this.db)
  }

  save(task: DownloadTask): void {
    if (!isTerminalTask(task)) {
      return
    }

    const row = serializeHistoryTask(task)

    this.db
      .insert(downloadHistoryTable)
      .values(row)
      .onConflictDoUpdate({
        target: downloadHistoryTable.id,
        set: { ...row }
      })
      .run()
  }

  list(): DownloadTask[] {
    const rows = this.db
      .select()
      .from(downloadHistoryTable)
      .orderBy(desc(downloadHistoryTable.sortKey))
      .all()

    const tasks: DownloadTask[] = []
    for (const row of rows) {
      const task = mapHistoryRowToTask(row)
      if (isTerminalTask(task)) {
        tasks.push(task)
      }
    }
    return tasks
  }

  removeItems(ids: string[]): number {
    const normalizedIds = ids.map((id) => id.trim()).filter((id) => id.length > 0)
    if (normalizedIds.length === 0) {
      return 0
    }
    const result = this.db
      .delete(downloadHistoryTable)
      .where(inArray(downloadHistoryTable.id, normalizedIds))
      .run()
    return result.changes
  }

  removeByPlaylist(playlistId: string): number {
    const normalizedPlaylistId = playlistId.trim()
    if (!normalizedPlaylistId) {
      return 0
    }
    const result = this.db
      .delete(downloadHistoryTable)
      .where(eq(downloadHistoryTable.playlistId, normalizedPlaylistId))
      .run()
    return result.changes
  }
}
