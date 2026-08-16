#!/usr/bin/env tsx
/**
 * One-shot migration: copy every row from the legacy `download_history`
 * table into the new task-queue `tasks` table as a terminal record with
 * `status_reason = 'legacy-import'`.
 *
 * Idempotent: re-running it is a no-op for rows that have already been
 * imported (matched by id).
 *
 * Containerized hosts wire this into a `before_start` hook so a fresh
 * container picks up legacy history transparently. On migration failure
 * the legacy DB is left untouched and the new task-queue DB rolls back
 * to the pre-migration state.
 *
 * Usage:
 *   tsx apps/api/scripts/migrate-history.ts
 *
 * Env vars (all optional):
 *   VIDBEE_HISTORY_STORE_PATH  – legacy sqlite db path (default uses
 *                                $VIDBEE_DOWNLOAD_DIR/.vidbee/vidbee.db)
 *   VIDBEE_TASK_QUEUE_DB       – task-queue sqlite db path (default uses
 *                                $VIDBEE_DOWNLOAD_DIR/.vidbee/task-queue.db)
 *   VIDBEE_DOWNLOAD_DIR        – default download directory
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { TASK_QUEUE_DDL_V1 } from '@vidbee/db/task-queue'
import {
  PRIORITY_BACKGROUND,
  type Task,
  type TaskOutput,
  type TaskStatus
} from '@vidbee/task-queue'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require('better-sqlite3') as typeof import('better-sqlite3')

const trim = (v?: string | null): string | undefined => {
  const t = v?.trim()
  return t && t.length > 0 ? t : undefined
}

const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads', 'VidBee')
const downloadDir =
  trim(process.env.VIDBEE_DOWNLOAD_DIR) ?? trim(process.env.DOWNLOAD_DIR) ?? DEFAULT_DOWNLOAD_DIR

const legacyDbPath =
  trim(process.env.VIDBEE_HISTORY_STORE_PATH) ?? path.join(downloadDir, '.vidbee', 'vidbee.db')

const taskQueueDbPath =
  trim(process.env.VIDBEE_TASK_QUEUE_DB) ?? path.join(downloadDir, '.vidbee', 'task-queue.db')

interface LegacyHistoryRow {
  id: string
  url: string
  title: string
  thumbnail: string | null
  type: string // 'video' | 'audio'
  status: string // 'completed' | 'error' | 'cancelled'
  download_path: string | null
  saved_file_name: string | null
  file_size: number | null
  duration: number | null
  downloaded_at: number
  completed_at: number | null
  sort_key: number
  error: string | null
  yt_dlp_command: string | null
  yt_dlp_log: string | null
  description: string | null
  channel: string | null
  uploader: string | null
  view_count: number | null
  tags: string | null
  origin: string | null
  subscription_id: string | null
  selected_format: string | null
  playlist_id: string | null
  playlist_title: string | null
  playlist_index: number | null
  playlist_size: number | null
}

const TERMINAL_LEGACY: Record<string, TaskStatus | undefined> = {
  completed: 'completed',
  error: 'failed',
  cancelled: 'cancelled'
}

function rowToTask(row: LegacyHistoryRow): Task | null {
  const status = TERMINAL_LEGACY[row.status]
  if (!status) {
    return null
  }

  const filePath =
    row.download_path && row.saved_file_name
      ? path.join(row.download_path, row.saved_file_name)
      : (row.download_path ?? '')

  const output: TaskOutput | null =
    status === 'completed'
      ? {
          filePath,
          size: row.file_size ?? 0,
          durationMs: row.duration == null ? null : row.duration * 1000,
          sha256: null
        }
      : null

  const completedAt = row.completed_at ?? row.downloaded_at

  return {
    id: row.id,
    kind: row.type === 'audio' ? 'audio' : 'video',
    parentId: null,
    input: {
      url: row.url,
      kind: row.type === 'audio' ? 'audio' : 'video',
      title: row.title,
      thumbnail: row.thumbnail ?? undefined,
      subscriptionId: row.subscription_id ?? undefined,
      playlistId: row.playlist_id ?? undefined,
      playlistIndex: row.playlist_index ?? undefined,
      options: {
        type: row.type === 'audio' ? 'audio' : 'video',
        title: row.title,
        thumbnail: row.thumbnail ?? undefined,
        description: row.description ?? undefined,
        channel: row.channel ?? undefined,
        uploader: row.uploader ?? undefined,
        viewCount: row.view_count ?? undefined,
        tags: parseTags(row.tags),
        duration: row.duration ?? undefined,
        playlistTitle: row.playlist_title ?? undefined,
        playlistSize: row.playlist_size ?? undefined,
        downloadPath: row.download_path ?? undefined,
        fileSize: row.file_size ?? undefined,
        startedAt: row.downloaded_at,
        completedAt
      }
    },
    priority: PRIORITY_BACKGROUND,
    groupKey: row.subscription_id ? `sub:${row.subscription_id}` : safeHost(row.url),
    status,
    prevStatus: null,
    statusReason: 'legacy-import',
    enteredStatusAt: completedAt,
    attempt: 0,
    maxAttempts: 0,
    nextRetryAt: null,
    progress: {
      percent: status === 'completed' ? 1 : null,
      bytesDownloaded: row.file_size ?? null,
      bytesTotal: row.file_size ?? null,
      speedBps: null,
      etaMs: null,
      ticks: 0
    },
    output,
    lastError:
      status === 'failed'
        ? {
            category: 'unknown',
            exitCode: null,
            rawMessage: row.error ?? 'legacy-import',
            uiMessageKey: 'errors.legacy_import',
            uiActionHints: [],
            retryable: false,
            suggestedRetryAfterMs: null
          }
        : null,
    pid: null,
    pidStartedAt: null,
    createdAt: row.downloaded_at,
    updatedAt: completedAt
  }
}

function parseTags(value: string | null): string[] | undefined {
  if (!value) {
    return undefined
  }
  const tags = value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return tags.length > 0 ? tags : undefined
}

function safeHost(url: string): string {
  try {
    return new URL(url).host || 'unknown'
  } catch {
    return 'unknown'
  }
}

function bindTask(task: Task): unknown[] {
  return [
    task.id,
    task.kind,
    task.parentId,
    task.status,
    task.prevStatus,
    task.statusReason,
    task.enteredStatusAt,
    task.priority,
    task.groupKey,
    task.attempt,
    task.maxAttempts,
    task.nextRetryAt,
    task.pid,
    task.pidStartedAt,
    task.createdAt,
    task.updatedAt,
    JSON.stringify(task.input),
    JSON.stringify(task.progress),
    task.output ? JSON.stringify(task.output) : null,
    task.lastError ? JSON.stringify(task.lastError) : null
  ]
}

async function main(): Promise<void> {
  if (!fs.existsSync(legacyDbPath)) {
    // eslint-disable-next-line no-console
    console.log(`[migrate-history] no legacy DB at ${legacyDbPath}; nothing to do.`)
    return
  }
  // Warn loudly if persistence is disabled — without it, the runtime API uses
  // an in-memory persist adapter and never reads the SQLite file we are about
  // to populate. The migration would silently appear to "succeed" but users
  // would see zero rows in /rpc/history/list. See bug #5 in NEX-124 review.
  const persistFlag = (process.env.VIDBEE_PERSIST_QUEUE ?? '').trim()
  const persistEnabled = persistFlag === '1' || persistFlag.toLowerCase() === 'true'
  if (!persistEnabled) {
    // eslint-disable-next-line no-console
    console.warn(
      '[migrate-history] WARNING: VIDBEE_PERSIST_QUEUE is not enabled. The ' +
        'migrated rows will not be visible at runtime because the API will use ' +
        'an in-memory queue. Set VIDBEE_PERSIST_QUEUE=1 (default in the bundled ' +
        'Dockerfile) to read this database back.'
    )
  }
  fs.mkdirSync(path.dirname(taskQueueDbPath), { recursive: true })

  const legacyDb = new Database(legacyDbPath, { readonly: true, fileMustExist: true })
  // Do NOT set journal_mode on a readonly handle — it's a write op and fails
  // with SQLITE_READONLY. The legacy DB is opened read-only by design so we
  // never mutate user data during migration.

  const queueDb = new Database(taskQueueDbPath, { timeout: 5000 })
  queueDb.pragma('journal_mode = WAL')
  queueDb.pragma('foreign_keys = ON')
  queueDb.exec(TASK_QUEUE_DDL_V1)

  // Mark in-flight migration so callers can detect partial state.
  queueDb
    .prepare(
      `INSERT INTO schema_meta (key, value) VALUES ('migration_in_progress','api-v1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run()

  const tableCheck = legacyDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='download_history'")
    .get() as { name?: string } | undefined

  if (!tableCheck?.name) {
    // eslint-disable-next-line no-console
    console.log('[migrate-history] legacy download_history table not present; nothing to do.')
    queueDb.prepare("DELETE FROM schema_meta WHERE key = 'migration_in_progress'").run()
    legacyDb.close()
    queueDb.close()
    return
  }

  const rows = legacyDb
    .prepare('SELECT * FROM download_history ORDER BY sort_key ASC')
    .all() as LegacyHistoryRow[]

  const insertOrSkip = queueDb.prepare(`
    INSERT INTO tasks (
      id, kind, parent_id, status, prev_status, status_reason, entered_status_at,
      priority, group_key, attempt, max_attempts, next_retry_at, pid,
      pid_started_at, created_at, updated_at, input_json, progress_json,
      output_json, last_error_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `)

  const tx = queueDb.transaction((tasks: Task[]) => {
    let imported = 0
    for (const task of tasks) {
      const result = insertOrSkip.run(...bindTask(task))
      if (result.changes > 0) {
        imported += 1
      }
    }
    return imported
  })

  let mappedTasks = 0
  let skippedRows = 0
  const tasks: Task[] = []
  for (const row of rows) {
    const task = rowToTask(row)
    if (task) {
      tasks.push(task)
      mappedTasks += 1
    } else {
      skippedRows += 1
    }
  }

  let imported = 0
  try {
    imported = tx(tasks) as number
  } catch (err) {
    // Roll back the migration marker; leave already-imported rows alone (the
    // unique-id INSERT is idempotent and re-running picks up where we stopped).
    queueDb.prepare("DELETE FROM schema_meta WHERE key = 'migration_in_progress'").run()
    legacyDb.close()
    queueDb.close()
    throw err
  }

  queueDb.prepare("DELETE FROM schema_meta WHERE key = 'migration_in_progress'").run()

  // Best-effort rename to mark the legacy DB as migrated. Container hosts
  // can pre-bind the mount as read-only; ignore EROFS.
  const migratedPath = `${legacyDbPath}.migrated`
  try {
    if (!fs.existsSync(migratedPath)) {
      fs.copyFileSync(legacyDbPath, migratedPath)
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[migrate-history] could not stamp legacy DB as migrated:', err)
  }

  legacyDb.close()
  queueDb.close()

  // eslint-disable-next-line no-console
  console.log(
    `[migrate-history] legacy rows: ${rows.length}, mapped: ${mappedTasks}, skipped: ${skippedRows}, imported: ${imported} (already-present skipped)`
  )
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[migrate-history] failed:', err)
  process.exit(1)
})
