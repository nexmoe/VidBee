import { existsSync } from 'node:fs'
import path from 'node:path'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../../../desktop/resources/drizzle')

export const runDatabaseMigrations = (database: BetterSQLite3Database): void => {
  if (!existsSync(MIGRATIONS_FOLDER)) {
    throw new Error(`API migrations folder not found: ${MIGRATIONS_FOLDER}`)
  }

  migrate(database, { migrationsFolder: MIGRATIONS_FOLDER })
}
