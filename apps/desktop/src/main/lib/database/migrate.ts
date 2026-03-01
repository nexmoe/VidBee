import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { app } from 'electron'

const MIGRATIONS_RELATIVE_PATH = 'resources/drizzle'
const MIGRATIONS_TABLE = '__drizzle_migrations'

export const runMigrations = (database: BetterSQLite3Database): void => {
  const migrationsFolder = resolveMigrationsFolder()
  if (!migrationsFolder) {
    throw new Error('drizzle migrations folder not found for desktop')
  }

  migrate(database, { migrationsFolder, migrationsTable: MIGRATIONS_TABLE })
}

const resolveMigrationsFolder = (): string | null => {
  const candidates = new Set<string>()
  candidates.add(resolve(process.cwd(), MIGRATIONS_RELATIVE_PATH))
  candidates.add(resolve(import.meta.dirname, '../../../../', MIGRATIONS_RELATIVE_PATH))

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
