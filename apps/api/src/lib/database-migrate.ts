import { existsSync } from 'node:fs'
import path from 'node:path'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

/** Resolve migrations from the production image or the source tree during development. */
const resolveMigrationsFolder = (): string => {
  const configuredFolder = process.env.VIDBEE_MIGRATIONS_DIR?.trim()
  if (configuredFolder) {
    return path.resolve(configuredFolder)
  }

  const runtimeFolder = path.resolve(process.cwd(), 'resources/drizzle')
  if (existsSync(runtimeFolder)) {
    return runtimeFolder
  }

  return path.resolve(import.meta.dirname, '../../../desktop/resources/drizzle')
}

/** Apply every pending Drizzle migration to the API database. */
export const runDatabaseMigrations = (database: BetterSQLite3Database): void => {
  const migrationsFolder = resolveMigrationsFolder()
  if (!existsSync(migrationsFolder)) {
    throw new Error(`API migrations folder not found: ${migrationsFolder}`)
  }

  migrate(database, { migrationsFolder })
}
