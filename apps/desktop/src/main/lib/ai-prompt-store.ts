import { applyPromptRunMigrations } from '@vidbee/db/prompt-runs'
import { isEphemeralPromptRunDownloadId, isTerminalPromptRunStatus } from '../../shared/ai-run'
import type {
  AiPromptErrorCode,
  AiPromptRunSnapshot,
  AiPromptRunStatus
} from '../../shared/ai-types'
import { scopedLoggers } from '../utils/logger'
import { getDatabaseConnection } from './database'

const log = scopedLoggers.ai

const ERROR_CODES = new Set<AiPromptErrorCode>([
  'no-provider',
  'missing-api-key',
  'missing-model',
  'unknown-prompt',
  'empty-transcript',
  'auth',
  'network',
  'empty-output',
  'unknown'
])

interface SqliteStatement {
  run(...params: unknown[]): { changes: number }
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  exec(sql: string): void
}

interface PromptRunDbRow {
  cloud_result_id: string | null
  download_id: string
  prompt_id: string
  status: string
  text: string
  thinking: string | null
  thinking_ms: number | null
  error: string | null
  error_code: string | null
  created_at: number
  updated_at: number
}

export interface AiPromptRunStoreOptions {
  db: SqliteDatabase
}

/**
 * True when a snapshot belongs on disk: a finished run for a real download.
 *
 * @param snapshot Latest run state.
 */
export const shouldPersistPromptRun = (snapshot: AiPromptRunSnapshot): boolean =>
  !isEphemeralPromptRunDownloadId(snapshot.downloadId) && isTerminalPromptRunStatus(snapshot.status)

/**
 * Parse a stored error-code string into the known union.
 *
 * @param value Column value from SQLite.
 */
const parseErrorCode = (value: string | null): AiPromptErrorCode | null => {
  if (!value) {
    return null
  }
  return ERROR_CODES.has(value as AiPromptErrorCode) ? (value as AiPromptErrorCode) : 'unknown'
}

/**
 * Parse a stored status. Non-terminal rows are ignored on load.
 *
 * @param value Column value from SQLite.
 */
const parseStatus = (value: string): AiPromptRunStatus | null => {
  if (!isTerminalPromptRunStatus(value as AiPromptRunStatus)) {
    return null
  }
  return value as AiPromptRunStatus
}

/**
 * Map a SQLite row onto the renderer snapshot.
 *
 * @param row Persisted prompt-run row.
 */
const snapshotFromRow = (row: PromptRunDbRow): AiPromptRunSnapshot | null => {
  const status = parseStatus(row.status)
  if (!status) {
    return null
  }
  return {
    cloudResultId: row.cloud_result_id ?? undefined,
    downloadId: row.download_id,
    promptId: row.prompt_id,
    status,
    text: row.text ?? '',
    thinking: row.thinking ?? '',
    thinkingMs: row.thinking_ms ?? 0,
    error: row.error,
    errorCode: parseErrorCode(row.error_code),
    updatedAt: row.updated_at
  }
}

/**
 * SQLite-backed store for terminal AI prompt results on `vidbee.db`.
 */
export class AiPromptRunStore {
  private readonly db: SqliteDatabase

  /**
   * Open the prompt-run table on an existing SQLite connection.
   *
   * @param opts Shared `vidbee.db` handle.
   */
  constructor(opts: AiPromptRunStoreOptions) {
    this.db = opts.db
    this.applySchema()
  }

  /**
   * Create the prompt-run table if this `vidbee.db` does not have it yet.
   */
  applySchema(): void {
    const columnNames = (
      this.db.prepare('PRAGMA table_info(transcript_prompt_runs)').all() as Array<{ name: string }>
    ).map((column) => column.name)
    applyPromptRunMigrations((sql) => {
      this.db.exec(sql)
    }, columnNames)
  }

  /**
   * Load the last finished result for a download/prompt pair.
   *
   * @param downloadId Download id.
   * @param promptId Prompt id.
   */
  load(downloadId: string, promptId: string): AiPromptRunSnapshot | null {
    if (isEphemeralPromptRunDownloadId(downloadId)) {
      return null
    }
    const row = this.db
      .prepare(
        `SELECT cloud_result_id, download_id, prompt_id, status, text, thinking, thinking_ms, error, error_code, created_at, updated_at
         FROM transcript_prompt_runs
         WHERE download_id = ? AND prompt_id = ?`
      )
      .get(downloadId, promptId) as PromptRunDbRow | undefined
    if (!row) {
      return null
    }
    return snapshotFromRow(row)
  }

  /**
   * Insert or replace a finished prompt result.
   *
   * @param snapshot Terminal run snapshot.
   */
  save(snapshot: AiPromptRunSnapshot): void {
    if (!shouldPersistPromptRun(snapshot)) {
      return
    }
    this.db
      .prepare(
        `INSERT INTO transcript_prompt_runs (
           download_id, prompt_id, status, text, thinking, thinking_ms, error, error_code, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(download_id, prompt_id) DO UPDATE SET
           status = excluded.status,
           text = excluded.text,
           thinking = excluded.thinking,
           thinking_ms = excluded.thinking_ms,
           error = excluded.error,
           error_code = excluded.error_code,
           updated_at = excluded.updated_at`
      )
      .run(
        snapshot.downloadId,
        snapshot.promptId,
        snapshot.status,
        snapshot.text,
        snapshot.thinking ?? '',
        snapshot.thinkingMs ?? 0,
        snapshot.error,
        snapshot.errorCode,
        snapshot.updatedAt,
        snapshot.updatedAt
      )
    this.db
      .prepare(
        'UPDATE transcript_prompt_runs SET cloud_result_id = ? WHERE download_id = ? AND prompt_id = ?'
      )
      .run(snapshot.cloudResultId ?? null, snapshot.downloadId, snapshot.promptId)
  }

  /**
   * Drop every stored prompt result for a download.
   *
   * @param downloadId Parent download id.
   */
  deleteByDownload(downloadId: string): void {
    if (isEphemeralPromptRunDownloadId(downloadId)) {
      return
    }
    this.db.prepare('DELETE FROM transcript_prompt_runs WHERE download_id = ?').run(downloadId)
  }
}

let store: AiPromptRunStore | null = null

/**
 * Return the process-wide store backed by the unified desktop database.
 */
export const getAiPromptRunStore = (): AiPromptRunStore => {
  if (store) {
    return store
  }
  const { sqlite } = getDatabaseConnection()
  store = new AiPromptRunStore({ db: sqlite })
  return store
}

/**
 * Persist a finished prompt result. Settings-test ids and in-flight runs are skipped.
 *
 * @param snapshot Latest run state.
 */
export const savePersistedPromptRun = (snapshot: AiPromptRunSnapshot): void => {
  if (!shouldPersistPromptRun(snapshot)) {
    return
  }
  try {
    getAiPromptRunStore().save(snapshot)
  } catch (error) {
    log.warn('failed to persist prompt run', {
      downloadId: snapshot.downloadId,
      promptId: snapshot.promptId,
      error
    })
  }
}

/**
 * Load a finished prompt result after a restart or memory miss.
 *
 * @param downloadId Download id.
 * @param promptId Prompt id.
 */
export const loadPersistedPromptRun = (
  downloadId: string,
  promptId: string
): AiPromptRunSnapshot | null => {
  if (isEphemeralPromptRunDownloadId(downloadId)) {
    return null
  }
  try {
    return getAiPromptRunStore().load(downloadId, promptId)
  } catch (error) {
    log.warn('failed to load persisted prompt run', { downloadId, promptId, error })
    return null
  }
}

/**
 * Drop stored prompt results for a download. Missing tables are ignored.
 *
 * @param downloadId Parent download id.
 */
export const deletePersistedPromptRunsForDownload = (downloadId: string): void => {
  if (isEphemeralPromptRunDownloadId(downloadId)) {
    return
  }
  try {
    getAiPromptRunStore().deleteByDownload(downloadId)
  } catch (error) {
    log.warn('failed to delete prompt runs', { downloadId, error })
  }
}
