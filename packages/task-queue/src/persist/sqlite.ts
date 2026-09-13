/**
 * SQLite implementation of PersistAdapter using better-sqlite3.
 *
 * Reference: docs/vidbee-task-queue-state-machine-design.md §9.
 *
 * Operational rules implemented here:
 *   - WAL + synchronous=NORMAL on connect.
 *   - Single writer: every write goes through this adapter.
 *   - transition writes use BEGIN IMMEDIATE.
 *   - PID/pidStartedAt are written synchronously at spawn.
 *   - maintenance() runs `wal_checkpoint(TRUNCATE)` and ages process_journal
 *     entries older than 30 days.
 *
 * The DDL itself is owned by `@vidbee/db/migrations` (added in this PR);
 * this adapter only opens the file and assumes migrations have run.
 */
import type {
  AttemptRow,
  ProcessJournalOp,
  ProcessJournalRow,
  Task,
  TaskProgress,
  TaskStatus
} from '../types'
import type {
  JournalAppendInput,
  PersistAdapter,
  PersistTransitionInput,
  RecordCloseInput,
  RecordSpawnInput
} from './adapter'

interface SqliteLikeStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
}

// Match better-sqlite3's `transaction()` shape without depending on its types:
// `transaction(fn)` returns the same callable plus `.immediate / .deferred /
// .exclusive` variants. We accept any function shape here because the wrapper
// is a transparent proxy.
type SqliteTransactionFn<F extends (...args: never[]) => unknown> = F & {
  immediate: F
  deferred: F
  exclusive: F
}

interface SqliteLikeDatabase {
  prepare(sql: string): SqliteLikeStatement
  exec(sql: string): void
  pragma(sql: string, opts?: { simple?: boolean }): unknown
  // biome-ignore lint/suspicious/noExplicitAny: structural match against better-sqlite3
  transaction<F extends (...args: any[]) => unknown>(fn: F): SqliteTransactionFn<F>
  close(): void
}

export interface SqlitePersistOptions {
  /** Open better-sqlite3 db; passed in so we don't import it eagerly. */
  db: SqliteLikeDatabase
  /** Override journal-aging window. Default 30 days. */
  journalAgeMs?: number
  /**
   * When false, `close()` does not close the underlying connection. Hosts
   * that share `vidbee.db` with other services must pass false.
   */
  ownsConnection?: boolean
}

const DEFAULT_JOURNAL_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Return descendant task ids, deepest-first, so `parent_id` FKs can be
 * deleted before the parent row.
 */
const collectDescendantIds = (selectChildIds: SqliteLikeStatement, rootId: string): string[] => {
  const out: string[] = []
  const walk = (id: string): void => {
    const rows = selectChildIds.all(id) as Array<{ id: string }>
    for (const row of rows) {
      walk(row.id)
      out.push(row.id)
    }
  }
  walk(rootId)
  return out
}

export class SqlitePersistAdapter implements PersistAdapter {
  private readonly db: SqliteLikeDatabase
  private readonly journalAgeMs: number
  private readonly ownsConnection: boolean

  // Prepared statements (lazy on first use to allow construction before
  // migrations have run in some test setups).
  private stmts!: Stmts

  constructor(opts: SqlitePersistOptions) {
    this.db = opts.db
    this.journalAgeMs = opts.journalAgeMs ?? DEFAULT_JOURNAL_AGE_MS
    this.ownsConnection = opts.ownsConnection ?? true
    this.applyPragmas()
  }

  async insertTask(task: Task): Promise<void> {
    this.ensureStmts()
    const tx = this.db.transaction((row: Task) => {
      this.stmts.insertTask.run(...this.bindTask(row))
    })
    tx.immediate(task)
  }

  async upsertTask(input: PersistTransitionInput): Promise<void> {
    this.ensureStmts()
    const tx = this.db.transaction((task: Task, progress: TaskProgress) => {
      this.stmts.upsertTask.run(...this.bindTask(task))
      this.stmts.upsertProgress.run(JSON.stringify(progress), task.id)
    })
    tx.immediate(input.task, input.progress)
  }

  async upsertProgress(taskId: string, progress: TaskProgress): Promise<void> {
    this.ensureStmts()
    this.stmts.upsertProgress.run(JSON.stringify(progress), taskId)
  }

  async deleteTask(taskId: string): Promise<void> {
    this.ensureStmts()
    const tx = this.db.transaction((id: string) => {
      for (const childId of collectDescendantIds(this.stmts.selectChildIds, id)) {
        this.stmts.deleteAttempts.run(childId)
        this.stmts.deleteTask.run(childId)
      }
      this.stmts.deleteAttempts.run(id)
      this.stmts.deleteTask.run(id)
    })
    tx.immediate(taskId)
  }

  async insertAttempt(input: RecordSpawnInput): Promise<void> {
    this.ensureStmts()
    // attempt_number is computed by the orchestrator (it equals task.attempt).
    // We need a numeric value; read it from the tasks table to be safe.
    const row = this.stmts.selectAttemptByTaskCount.get(input.taskId) as
      | { n: number | bigint }
      | undefined
    const attemptNumber = Number(row?.n ?? 0) + 1
    this.stmts.insertAttempt.run(
      input.attemptId,
      input.taskId,
      attemptNumber,
      input.startedAt,
      input.rawArgsHash
    )
  }

  async closeAttempt(input: RecordCloseInput): Promise<void> {
    this.ensureStmts()
    this.stmts.closeAttempt.run(
      input.endedAt,
      input.exitCode,
      input.errorCategory,
      input.stdoutTail,
      input.stderrTail,
      input.attemptId
    )
  }

  async appendJournal(input: JournalAppendInput): Promise<void> {
    this.ensureStmts()
    this.stmts.appendJournal.run(
      input.ts,
      input.op,
      input.taskId,
      input.attemptId,
      input.pid,
      input.pidStartedAt,
      input.exitCode,
      input.signal
    )
  }

  async findOpenSpawns(): Promise<ProcessJournalRow[]> {
    this.ensureStmts()
    const rows = this.stmts.findOpenSpawns.all() as Array<{
      seq: number | bigint
      ts: number
      op: ProcessJournalOp
      task_id: string
      attempt_id: string | null
      pid: number
      pid_started_at: number | null
      exit_code: number | null
      signal: string | null
    }>
    return rows.map((r) => ({
      seq: Number(r.seq),
      ts: r.ts,
      op: r.op,
      taskId: r.task_id,
      attemptId: r.attempt_id,
      pid: r.pid,
      pidStartedAt: r.pid_started_at,
      exitCode: r.exit_code,
      signal: r.signal
    }))
  }

  async loadAllTasks(): Promise<Task[]> {
    this.ensureStmts()
    const rows = this.stmts.loadAllTasks.all() as TaskDbRow[]
    return rows.map(rowToTask)
  }

  async loadLatestAttempt(taskId: string): Promise<AttemptRow | null> {
    this.ensureStmts()
    const row = this.stmts.loadLatestAttempt.get(taskId) as AttemptDbRow | undefined
    if (!row) return null
    return {
      id: row.id,
      taskId: row.task_id,
      attemptNumber: row.attempt_number,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      exitCode: row.exit_code,
      errorCategory: row.error_category as AttemptRow['errorCategory'],
      stdoutTail: row.stdout_tail,
      stderrTail: row.stderr_tail,
      rawArgsHash: row.raw_args_hash
    }
  }

  async maintenance(): Promise<void> {
    this.ensureStmts()
    const cutoff = Date.now() - this.journalAgeMs
    this.stmts.ageJournal.run(cutoff)
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      // checkpoint failure is non-fatal
    }
  }

  close(): void {
    if (!this.ownsConnection) {
      return
    }
    try {
      this.db.close()
    } catch {
      /* noop */
    }
  }

  private applyPragmas(): void {
    try {
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')
      this.db.pragma('foreign_keys = ON')
    } catch {
      // tests pass in stub dbs that don't support pragmas
    }
  }

  private ensureStmts(): void {
    if (this.stmts) return
    this.stmts = {
      insertTask: this.db.prepare(SQL_INSERT_TASK),
      upsertTask: this.db.prepare(SQL_UPSERT_TASK),
      upsertProgress: this.db.prepare(SQL_UPSERT_PROGRESS),
      deleteTask: this.db.prepare('DELETE FROM tasks WHERE id = ?'),
      deleteAttempts: this.db.prepare('DELETE FROM attempts WHERE task_id = ?'),
      selectChildIds: this.db.prepare('SELECT id FROM tasks WHERE parent_id = ?'),
      insertAttempt: this.db.prepare(SQL_INSERT_ATTEMPT),
      closeAttempt: this.db.prepare(SQL_CLOSE_ATTEMPT),
      appendJournal: this.db.prepare(SQL_APPEND_JOURNAL),
      findOpenSpawns: this.db.prepare(SQL_FIND_OPEN_SPAWNS),
      loadAllTasks: this.db.prepare(SQL_LOAD_ALL_TASKS),
      loadLatestAttempt: this.db.prepare(SQL_LOAD_LATEST_ATTEMPT),
      ageJournal: this.db.prepare(SQL_AGE_JOURNAL),
      selectAttemptByTaskCount: this.db.prepare(
        'SELECT COUNT(*) AS n FROM attempts WHERE task_id = ?'
      )
    }
  }

  private bindTask(t: Task): unknown[] {
    return [
      t.id,
      t.kind,
      t.parentId,
      t.status,
      t.prevStatus,
      t.statusReason,
      t.enteredStatusAt,
      t.priority,
      t.groupKey,
      t.attempt,
      t.maxAttempts,
      t.nextRetryAt,
      t.pid,
      t.pidStartedAt,
      t.createdAt,
      t.updatedAt,
      JSON.stringify(t.input),
      JSON.stringify(t.progress),
      t.output ? JSON.stringify(t.output) : null,
      t.lastError ? JSON.stringify(t.lastError) : null
    ]
  }
}

interface Stmts {
  insertTask: SqliteLikeStatement
  upsertTask: SqliteLikeStatement
  upsertProgress: SqliteLikeStatement
  deleteTask: SqliteLikeStatement
  deleteAttempts: SqliteLikeStatement
  selectChildIds: SqliteLikeStatement
  insertAttempt: SqliteLikeStatement
  closeAttempt: SqliteLikeStatement
  appendJournal: SqliteLikeStatement
  findOpenSpawns: SqliteLikeStatement
  loadAllTasks: SqliteLikeStatement
  loadLatestAttempt: SqliteLikeStatement
  ageJournal: SqliteLikeStatement
  selectAttemptByTaskCount: SqliteLikeStatement
}

interface TaskDbRow {
  id: string
  kind: string
  parent_id: string | null
  status: TaskStatus
  prev_status: TaskStatus | null
  status_reason: string | null
  entered_status_at: number
  priority: number
  group_key: string
  attempt: number
  max_attempts: number
  next_retry_at: number | null
  pid: number | null
  pid_started_at: number | null
  created_at: number
  updated_at: number
  input_json: string
  first_started_at: number | null
  progress_json: string | null
  output_json: string | null
  last_error_json: string | null
}

interface AttemptDbRow {
  id: string
  task_id: string
  attempt_number: number
  started_at: number
  ended_at: number | null
  exit_code: number | null
  error_category: string | null
  stdout_tail: string | null
  stderr_tail: string | null
  raw_args_hash: string
}

/** Restore lifecycle timestamps from recorded attempts for older task rows. */
function rowToTask(r: TaskDbRow): Task {
  const input = JSON.parse(r.input_json) as Task['input']
  if (input.options?.startedAt == null && r.first_started_at != null) {
    input.options = { ...input.options, startedAt: r.first_started_at }
  }
  return {
    id: r.id,
    kind: r.kind as Task['kind'],
    parentId: r.parent_id,
    input,
    priority: r.priority as Task['priority'],
    groupKey: r.group_key,
    status: r.status,
    prevStatus: r.prev_status,
    statusReason: r.status_reason,
    enteredStatusAt: r.entered_status_at,
    attempt: r.attempt,
    maxAttempts: r.max_attempts,
    nextRetryAt: r.next_retry_at,
    progress: r.progress_json
      ? JSON.parse(r.progress_json)
      : {
          percent: null,
          bytesDownloaded: null,
          bytesTotal: null,
          speedBps: null,
          etaMs: null,
          ticks: 0
        },
    output: r.output_json ? JSON.parse(r.output_json) : null,
    lastError: r.last_error_json ? JSON.parse(r.last_error_json) : null,
    pid: r.pid,
    pidStartedAt: r.pid_started_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

const SQL_INSERT_TASK = `
INSERT INTO tasks (
  id, kind, parent_id, status, prev_status, status_reason, entered_status_at,
  priority, group_key, attempt, max_attempts, next_retry_at, pid,
  pid_started_at, created_at, updated_at, input_json, progress_json,
  output_json, last_error_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

const SQL_UPSERT_TASK = `
INSERT INTO tasks (
  id, kind, parent_id, status, prev_status, status_reason, entered_status_at,
  priority, group_key, attempt, max_attempts, next_retry_at, pid,
  pid_started_at, created_at, updated_at, input_json, progress_json,
  output_json, last_error_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  kind = excluded.kind,
  parent_id = excluded.parent_id,
  status = excluded.status,
  prev_status = excluded.prev_status,
  status_reason = excluded.status_reason,
  entered_status_at = excluded.entered_status_at,
  priority = excluded.priority,
  group_key = excluded.group_key,
  attempt = excluded.attempt,
  max_attempts = excluded.max_attempts,
  next_retry_at = excluded.next_retry_at,
  pid = excluded.pid,
  pid_started_at = excluded.pid_started_at,
  updated_at = excluded.updated_at,
  input_json = excluded.input_json,
  progress_json = excluded.progress_json,
  output_json = excluded.output_json,
  last_error_json = excluded.last_error_json
`

const SQL_UPSERT_PROGRESS = `
UPDATE tasks SET progress_json = ?, updated_at = strftime('%s', 'now') * 1000 WHERE id = ?
`

const SQL_INSERT_ATTEMPT = `
INSERT INTO attempts (id, task_id, attempt_number, started_at, raw_args_hash)
VALUES (?, ?, ?, ?, ?)
`

const SQL_CLOSE_ATTEMPT = `
UPDATE attempts SET
  ended_at = ?,
  exit_code = ?,
  error_category = ?,
  stdout_tail = ?,
  stderr_tail = ?
WHERE id = ?
`

const SQL_APPEND_JOURNAL = `
INSERT INTO process_journal (ts, op, task_id, attempt_id, pid, pid_started_at, exit_code, signal)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`

const SQL_FIND_OPEN_SPAWNS = `
SELECT s.*
FROM process_journal s
WHERE s.op = 'spawn'
  AND NOT EXISTS (
    SELECT 1 FROM process_journal c
    WHERE c.task_id = s.task_id
      AND IFNULL(c.attempt_id, '') = IFNULL(s.attempt_id, '')
      AND c.pid = s.pid
      AND c.op IN ('close', 'killed')
      AND c.seq > s.seq
  )
ORDER BY s.seq ASC
`

const SQL_LOAD_ALL_TASKS = `
SELECT tasks.*, (
  SELECT MIN(started_at) FROM attempts WHERE attempts.task_id = tasks.id
) AS first_started_at
FROM tasks`

const SQL_LOAD_LATEST_ATTEMPT = `
SELECT * FROM attempts
WHERE task_id = ?
ORDER BY attempt_number DESC
LIMIT 1
`

const SQL_AGE_JOURNAL = `
DELETE FROM process_journal WHERE ts < ?
`
