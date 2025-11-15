import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { type MigrationMeta, readMigrationFiles } from 'drizzle-orm/migrator'
import { app } from 'electron'
import log from 'electron-log/main'

const MIGRATIONS_RELATIVE_PATH = 'resources/drizzle'
const MIGRATIONS_TABLE = '__drizzle_migrations'
const KNOWN_TABLES = ['download_history', 'subscriptions', 'subscription_items']

const migrationsTableDefinition = sql`
  CREATE TABLE IF NOT EXISTS ${sql.identifier(MIGRATIONS_TABLE)} (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )
`

export const runMigrations = (database: BetterSQLite3Database): void => {
  const migrationsFolder = resolveMigrationsFolder()
  if (!migrationsFolder) {
    log.warn('database: drizzle migrations folder not found, skipping migrations')
    return
  }

  try {
    ensureBaseline(database, migrationsFolder)
    migrate(database, { migrationsFolder, migrationsTable: MIGRATIONS_TABLE })
  } catch (error) {
    log.error('database: failed to run drizzle migrations', error)
  }
}

const resolveMigrationsFolder = (): string | null => {
  const candidates = new Set<string>()
  candidates.add(resolve(process.cwd(), MIGRATIONS_RELATIVE_PATH))
  candidates.add(resolve(__dirname, '../../../../', MIGRATIONS_RELATIVE_PATH))

  if (process.resourcesPath) {
    candidates.add(join(process.resourcesPath, MIGRATIONS_RELATIVE_PATH))
    candidates.add(join(process.resourcesPath, 'app.asar.unpacked', MIGRATIONS_RELATIVE_PATH))
  }

  try {
    candidates.add(join(app.getAppPath(), MIGRATIONS_RELATIVE_PATH))
  } catch {
    // app might not be ready yet, ignore
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

const ensureBaseline = (database: BetterSQLite3Database, migrationsFolder: string): void => {
  if (hasTable(database, MIGRATIONS_TABLE)) {
    return
  }

  const hasExistingSchema = KNOWN_TABLES.some((table) => hasTable(database, table))
  if (!hasExistingSchema) {
    return
  }

  log.info('database: detected existing schema, seeding drizzle migrations baseline')
  database.run(migrationsTableDefinition)

  let migrations: MigrationMeta[]
  try {
    migrations = readMigrationFiles({ migrationsFolder, migrationsTable: MIGRATIONS_TABLE })
  } catch (error) {
    log.error('database: failed to read drizzle migrations while seeding baseline', error)
    return
  }

  database.transaction((tx) => {
    for (const migration of migrations) {
      tx.run(
        sql`INSERT INTO ${sql.identifier(MIGRATIONS_TABLE)} ("hash", "created_at") VALUES(${migration.hash}, ${migration.folderMillis})`
      )
    }
  })
}

const hasTable = (database: BetterSQLite3Database, tableName: string): boolean => {
  const rows = database.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${tableName}`
  )
  return rows.length > 0
}
