import type { Database as BetterSqlite3Instance } from 'better-sqlite3'
import DatabaseConstructor from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import log from 'electron-log/main'
import { runMigrations } from './database/migrate'
import { getDatabaseFilePath } from './database-path'

const logger = log.scope('database')

type DatabaseConnection = {
  sqlite: BetterSqlite3Instance
  db: BetterSQLite3Database
  path: string
}

let connection: DatabaseConnection | null = null
let migrationsReady = false

export const getDatabaseConnection = (): DatabaseConnection => {
  if (connection) {
    if (!migrationsReady) {
      runMigrations(connection.db)
      migrationsReady = true
    }
    return connection
  }

  const databasePath = getDatabaseFilePath()
  const sqlite = new DatabaseConstructor(databasePath, { timeout: 5000 })
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite)
  connection = { sqlite, db, path: databasePath }
  runMigrations(db)
  migrationsReady = true
  logger.info(`database initialized at ${databasePath}`)
  return connection
}
