import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { type MigrationMeta, readMigrationFiles } from 'drizzle-orm/migrator'
import { app } from 'electron'
import log from 'electron-log/main'

const logger = log.scope('database')

const MIGRATIONS_RELATIVE_PATH = 'resources/drizzle'
const MIGRATIONS_TABLE = '__drizzle_migrations'
const KNOWN_TABLES = ['download_history', 'subscriptions', 'subscription_items']
const MIGRATIONS_JOURNAL_PATH = 'meta/_journal.json'
const MIGRATIONS_META_DIR = 'meta'
const LEGACY_HISTORY_MIGRATIONS = [
  { tag: '0001_smiling_agent_zero', column: 'yt_dlp_command' },
  { tag: '0002_smooth_impossible_man', column: 'yt_dlp_log' }
]

const migrationsTableDefinition = sql`
  CREATE TABLE IF NOT EXISTS ${sql.identifier(MIGRATIONS_TABLE)} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash text NOT NULL,
    created_at numeric
  )
`

export const runMigrations = (database: BetterSQLite3Database): void => {
  const migrationsFolder = resolveMigrationsFolder()
  if (!migrationsFolder) {
    logger.warn('drizzle migrations folder not found, skipping migrations')
    return
  }

  try {
    const canRun = ensureBaseline(database, migrationsFolder)
    if (!canRun) {
      return
    }
    skipLegacyHistoryMigration(database, migrationsFolder)
    migrate(database, { migrationsFolder, migrationsTable: MIGRATIONS_TABLE })
  } catch (error) {
    logger.error('failed to run drizzle migrations', error)
  }
}

type JournalEntry = {
  idx: number
  tag: string
  when: number
  breakpoints: boolean
}

type Snapshot = {
  tables?: Record<string, { columns?: Record<string, unknown> }>
}

const readJournalEntries = (migrationsFolder: string): JournalEntry[] | null => {
  const journalPath = join(migrationsFolder, MIGRATIONS_JOURNAL_PATH)
  if (!existsSync(journalPath)) {
    return null
  }
  try {
    const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as { entries?: JournalEntry[] }
    return journal.entries ?? []
  } catch (error) {
    logger.warn('failed to read drizzle migrations journal', error)
    return null
  }
}

const resolveSnapshotPath = (migrationsFolder: string, index: number): string => {
  const snapshotName = `${index.toString().padStart(4, '0')}_snapshot.json`
  return join(migrationsFolder, MIGRATIONS_META_DIR, snapshotName)
}

const readSnapshot = (migrationsFolder: string, index: number): Snapshot | null => {
  const snapshotPath = resolveSnapshotPath(migrationsFolder, index)
  if (!existsSync(snapshotPath)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(snapshotPath, 'utf-8')) as Snapshot
  } catch (error) {
    logger.warn('failed to read drizzle snapshot', error)
    return null
  }
}

const snapshotMatchesDatabase = (database: BetterSQLite3Database, snapshot: Snapshot): boolean => {
  if (!snapshot.tables) {
    return false
  }

  for (const [tableName, table] of Object.entries(snapshot.tables)) {
    const expectedColumns = Object.keys(table.columns ?? {})
    if (expectedColumns.length === 0) {
      return false
    }
    const rows = database.all<{ name: string }>(sql.raw(`PRAGMA table_info(${tableName})`))
    const actualColumns = new Set(rows.map((row) => row.name))
    if (actualColumns.size !== expectedColumns.length) {
      return false
    }
    for (const columnName of expectedColumns) {
      if (!actualColumns.has(columnName)) {
        return false
      }
    }
  }

  return true
}

const resolveBaselineIndex = (
  database: BetterSQLite3Database,
  migrationsFolder: string,
  entries: JournalEntry[]
): number | null => {
  let baselineIndex: number | null = null
  entries.forEach((entry, index) => {
    const snapshot = readSnapshot(migrationsFolder, entry.idx)
    if (!snapshot) {
      return
    }
    if (snapshotMatchesDatabase(database, snapshot)) {
      baselineIndex = index
    }
  })
  return baselineIndex
}

const skipLegacyHistoryMigration = (
  database: BetterSQLite3Database,
  migrationsFolder: string
): void => {
  const entries = readJournalEntries(migrationsFolder)
  if (!entries || entries.length === 0) {
    return
  }

  const columns = database.all<{ name: string }>(sql`PRAGMA table_info(download_history)`)
  const existingColumns = new Set(columns.map((column) => column.name))
  const targets = LEGACY_HISTORY_MIGRATIONS.filter((migration) =>
    existingColumns.has(migration.column)
  )
  if (targets.length === 0) {
    return
  }

  let migrations: MigrationMeta[]
  try {
    migrations = readMigrationFiles({ migrationsFolder, migrationsTable: MIGRATIONS_TABLE })
  } catch (error) {
    logger.warn('failed to read drizzle migrations while skipping legacy history', error)
    return
  }

  database.run(migrationsTableDefinition)
  const tagToIndex = new Map(entries.map((entry, index) => [entry.tag, index]))
  let inserted = 0

  for (const target of targets) {
    const migrationIndex = tagToIndex.get(target.tag)
    if (migrationIndex === undefined) {
      logger.error(`legacy history migration tag not found in journal: ${target.tag}`)
      continue
    }
    const migration = migrations[migrationIndex]
    if (!migration) {
      logger.error(`legacy history migration file missing for tag: ${target.tag}`)
      continue
    }
    const applied = database.all<{ hash: string }>(
      sql`SELECT hash FROM ${sql.identifier(MIGRATIONS_TABLE)} WHERE hash = ${migration.hash}`
    )
    if (applied.length > 0) {
      continue
    }
    database.run(
      sql`INSERT INTO ${sql.identifier(MIGRATIONS_TABLE)} ("hash", "created_at") VALUES(${migration.hash}, ${migration.folderMillis})`
    )
    inserted++
  }

  if (targets.length === LEGACY_HISTORY_MIGRATIONS.length) {
    logger.info(
      `skipped legacy history migrations; columns already exist in download_history: ${targets
        .map((t) => t.column)
        .join(', ')}`
    )
    return
  }

  if (inserted > 0) {
    logger.warn(
      'legacy history migrations partially applied; remaining migrations will run automatically'
    )
  } else {
    logger.error(
      'legacy history migrations detected but none could be marked as applied. Manual migration required.'
    )
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

const ensureBaseline = (database: BetterSQLite3Database, migrationsFolder: string): boolean => {
  if (hasTable(database, MIGRATIONS_TABLE)) {
    return true
  }

  const hasExistingSchema = KNOWN_TABLES.some((table) => hasTable(database, table))
  if (!hasExistingSchema) {
    return true
  }

  const entries = readJournalEntries(migrationsFolder)
  if (!entries || entries.length === 0) {
    logger.error('existing schema found but no migrations journal available')
    return false
  }

  const baselineIndex = resolveBaselineIndex(database, migrationsFolder, entries)
  if (baselineIndex === null) {
    logger.error('existing schema does not match known snapshots; aborting migrations')
    return false
  }

  let migrations: MigrationMeta[]
  try {
    migrations = readMigrationFiles({ migrationsFolder, migrationsTable: MIGRATIONS_TABLE })
  } catch (error) {
    logger.error('failed to read drizzle migrations while seeding baseline', error)
    return false
  }

  const baselineEntry = entries[baselineIndex]
  if (!baselineEntry) {
    logger.error('failed to resolve baseline migration entry')
    return false
  }

  logger.info(`seeding drizzle migrations baseline at ${baselineEntry.tag}`)
  database.run(migrationsTableDefinition)

  database.transaction((tx) => {
    for (const migration of migrations.slice(0, baselineIndex + 1)) {
      tx.run(
        sql`INSERT INTO ${sql.identifier(MIGRATIONS_TABLE)} ("hash", "created_at") VALUES(${migration.hash}, ${migration.folderMillis})`
      )
    }
  })

  return true
}

const hasTable = (database: BetterSQLite3Database, tableName: string): boolean => {
  const rows = database.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${tableName}`
  )
  return rows.length > 0
}
