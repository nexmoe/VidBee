/**
 * Single SQLite file for the self-hosted API, matching Desktop's vidbee.db.
 *
 * Holds the task queue, transcripts, and subscriptions. Settings stay in
 * web-settings.json next to this file. Set VIDBEE_PERSIST_QUEUE=0 to keep an
 * in-memory database for tests.
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { applySubscriptionsMigrations } from '@vidbee/db/subscriptions'
import { TASK_QUEUE_DDL_V1 } from '@vidbee/db/task-queue'
import { TRANSCRIPT_DDL_V1 } from '@vidbee/db/transcripts'
import { log } from '@vidbee/logger'
import { mergeLegacyTaskQueueDb } from '@vidbee/transcription'
import type { Database as BetterSqlite3Instance } from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { apiDataDir, apiDbFile, trimEnv } from './api-paths'

const require = createRequire(import.meta.url)

export interface ApiDatabaseConnection {
  db: BetterSQLite3Database
  path: string
  persistent: boolean
  sqlite: BetterSqlite3Instance
}

export const isApiDatabasePersistent = (): boolean => trimEnv('VIDBEE_PERSIST_QUEUE') !== '0'

export const getDatabaseFilePath = (): string => {
  if (!isApiDatabasePersistent()) {
    return ':memory:'
  }
  return trimEnv('VIDBEE_DB') ?? apiDbFile
}

const escapeSqliteLiteral = (value: string): string => value.replaceAll("'", "''")

const subscriptionColumnNames = (sqlite: BetterSqlite3Instance): string[] => {
  const cols = sqlite.prepare('PRAGMA table_info(subscriptions)').all() as Array<{ name?: string }>
  return cols.map((col) => col.name).filter((name): name is string => Boolean(name))
}

const applyHostSchema = (sqlite: BetterSqlite3Instance): void => {
  sqlite.exec(TASK_QUEUE_DDL_V1)
  sqlite.exec(TRANSCRIPT_DDL_V1)
  applySubscriptionsMigrations((sql) => sqlite.exec(sql), subscriptionColumnNames(sqlite))
}

/**
 * Copy standalone subscriptions.db rows into the unified vidbee.db.
 *
 * @param target Open vidbee.db connection.
 * @param legacyPath Previous subscriptions-only sqlite file.
 * @returns Number of subscription rows copied.
 */
export const mergeLegacySubscriptionsDb = (
  target: BetterSqlite3Instance,
  targetPath: string,
  legacyPath: string
): number => {
  if (!fs.existsSync(legacyPath)) {
    return 0
  }
  if (path.resolve(legacyPath) === path.resolve(targetPath)) {
    return 0
  }

  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  const legacy = new Database(legacyPath, { fileMustExist: true, timeout: 5000 })
  try {
    applySubscriptionsMigrations((sql) => legacy.exec(sql), subscriptionColumnNames(legacy))
    applyHostSchema(target)
    const alias = 'legacy_subs'
    target.exec(`ATTACH DATABASE '${escapeSqliteLiteral(legacyPath)}' AS ${alias}`)
    try {
      const before = (
        target.prepare('SELECT COUNT(*) AS count FROM subscriptions').get() as { count: number }
      ).count
      target.exec(`INSERT OR IGNORE INTO main.subscriptions SELECT * FROM ${alias}.subscriptions`)
      target.exec(
        `INSERT OR IGNORE INTO main.subscription_items SELECT * FROM ${alias}.subscription_items`
      )
      target.exec(
        `INSERT OR IGNORE INTO main.subscriptions_meta SELECT * FROM ${alias}.subscriptions_meta`
      )
      const after = (
        target.prepare('SELECT COUNT(*) AS count FROM subscriptions').get() as { count: number }
      ).count
      return Math.max(0, after - before)
    } finally {
      target.exec(`DETACH DATABASE ${alias}`)
    }
  } finally {
    legacy.close()
  }
}

let connection: ApiDatabaseConnection | null = null

export const getDatabaseConnection = (): ApiDatabaseConnection => {
  if (connection) {
    return connection
  }

  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  const persistent = isApiDatabasePersistent()
  const databasePath = getDatabaseFilePath()
  if (persistent) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  }
  const sqlite = new Database(databasePath, { timeout: 5000 })
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  applyHostSchema(sqlite)

  if (persistent) {
    const legacyTaskQueueDbPath =
      trimEnv('VIDBEE_TASK_QUEUE_DB') ?? path.join(apiDataDir, 'task-queue.db')
    if (legacyTaskQueueDbPath !== databasePath && fs.existsSync(legacyTaskQueueDbPath)) {
      mergeLegacyTaskQueueDb({
        target: sqlite,
        legacyPath: legacyTaskQueueDbPath,
        openLegacy: (legacyPath) => new Database(legacyPath, { timeout: 5000, fileMustExist: true })
      })
    }
    const legacySubscriptionsDbPath =
      trimEnv('VIDBEE_SUBSCRIPTIONS_DB') ?? path.join(apiDataDir, 'subscriptions.db')
    const copied = mergeLegacySubscriptionsDb(sqlite, databasePath, legacySubscriptionsDbPath)
    if (copied > 0) {
      log.info({
        event: 'database',
        message: `merged ${copied} subscriptions into vidbee.db`,
        meta: { from: legacySubscriptionsDbPath }
      })
    }
  }

  const db = drizzle(sqlite)
  connection = { db, path: databasePath, persistent, sqlite }
  log.info({
    event: 'database',
    message: persistent ? `sqlite initialized at ${databasePath}` : 'sqlite initialized in memory',
    meta: { persistent }
  })
  return connection
}
