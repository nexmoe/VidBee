import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import type { Database } from 'better-sqlite3'
import type {
  AgentArtifact,
  AgentChatRun,
  AgentRunEvent,
  AgentThread
} from '../../shared/agent-chat'
import { sanitizeAgentConversationTitle } from '../../shared/agent-history'
import { agentActivity } from './agent-activity'
import { loadPersistedPromptRun } from './ai-prompt-store'
import { getDatabaseConnection } from './database'

export interface SaveScope {
  thread?: boolean
  messageIds?: string[]
  runIds?: string[]
  artifactIds?: string[]
}

const EVENT_RETENTION = 1000
const IMAGE_UNAVAILABLE = '[Image unavailable; it was removed from disk]'

/**
 * Replace inline image data with artifact references before persistence.
 *
 * @param entry SDK session log entry.
 * @param artifacts Conversation artifacts that may own the image bytes.
 */
export function dehydrateEntry(entry: SessionEntry, _artifacts: AgentArtifact[]): SessionEntry {
  if (entry.type !== 'message' || entry.message.role !== 'toolResult') {
    return entry
  }
  const message = entry.message
  if (!(Array.isArray(message.content) && message.content.some((part) => part.type === 'image'))) {
    return entry
  }
  const ids = artifactIdsFromDetails(message.details)
  let index = 0
  const content = message.content.map((part) => {
    if (
      part.type !== 'image' ||
      typeof part.data !== 'string' ||
      part.data.startsWith('artifact:')
    ) {
      return part
    }
    const id = ids[index++]
    if (!id) {
      return { type: 'text' as const, text: IMAGE_UNAVAILABLE }
    }
    return { ...part, data: `artifact:${id}` }
  })
  return { ...entry, message: { ...message, content } }
}

/**
 * Restore image bytes from artifact files; missing files become text placeholders.
 *
 * @param entry Persisted session log entry.
 * @param artifacts Conversation artifacts.
 */
export function rehydrateEntry(entry: SessionEntry, artifacts: AgentArtifact[]): SessionEntry {
  if (entry.type !== 'message' || entry.message.role !== 'toolResult') {
    return entry
  }
  const message = entry.message
  if (!Array.isArray(message.content)) {
    return entry
  }
  const content = message.content.flatMap((part) => {
    if (
      part.type !== 'image' ||
      typeof part.data !== 'string' ||
      !part.data.startsWith('artifact:')
    ) {
      return [part]
    }
    const id = part.data.slice('artifact:'.length)
    const artifact = artifacts.find((item) => item.id === id)
    const file = artifact?.kind === 'image' ? artifact.path : artifact?.posterPath
    if (!(file && existsSync(file))) {
      return [{ type: 'text' as const, text: IMAGE_UNAVAILABLE }]
    }
    return [{ ...part, data: readFileSync(file).toString('base64') }]
  })
  return { ...entry, message: { ...message, content } }
}

/**
 * Collect artifact ids recorded on a tool result.
 *
 * @param details Tool result details blob.
 */
function artifactIdsFromDetails(details: unknown): string[] {
  if (!details || typeof details !== 'object') {
    return []
  }
  const record = details as { artifacts?: unknown; artifact?: unknown }
  const list = Array.isArray(record.artifacts)
    ? record.artifacts
    : record.artifact
      ? [record.artifact]
      : []
  return list.flatMap((item) =>
    item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
      ? [(item as { id: string }).id]
      : []
  )
}

/**
 * Persistable run metadata without the in-memory history copies.
 *
 * @param run Live run object.
 * @param keepRawMessages True for unread legacy rows that have no session entries.
 */
function persistableRun(run: AgentChatRun, keepRawMessages: boolean): AgentChatRun {
  return {
    ...run,
    rawMessages: keepRawMessages ? run.rawMessages : [],
    sessionEntries: undefined
  }
}

/** SQLite is the source of truth; full provider messages never travel to the renderer. */
export class AgentChatStore {
  private readonly db: Database
  /** Create additive tables and recover executions interrupted by a process exit. */
  constructor(db: Database) {
    this.db = db
    db.exec(`CREATE TABLE IF NOT EXISTS agent_threads (id TEXT PRIMARY KEY, download_id TEXT NOT NULL, prompt_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_artifacts (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_events (thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(thread_id,seq));
      CREATE TABLE IF NOT EXISTS agent_run_entries (run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (run_id, seq));
      CREATE TABLE IF NOT EXISTS agent_schema (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS agent_threads_download_prompt ON agent_threads (download_id, prompt_id);`)
    this.dropLegacyThreadUniqueness()
    this.migrateToEntryStorage()
    for (const row of db.prepare('SELECT id FROM agent_threads').all() as { id: string }[]) {
      const thread = this.get(row.id)
      if (!thread) {
        continue
      }
      let changed = false
      for (const run of thread.runs) {
        if (run.status !== 'running') {
          continue
        }
        run.status = 'interrupted'
        run.error = 'Execution interrupted by application restart.'
        run.updatedAt = Date.now()
        for (const tool of run.tools) {
          if (tool.status === 'running' || tool.status === 'pending-approval') {
            tool.status = 'error'
          }
        }
        changed = true
      }
      if (changed) {
        this.save(thread, 'run.interrupted')
      }
    }
  }

  /** Open one video/agent thread, importing its previous result exactly once. */
  open(downloadId: string, promptId: string): AgentThread {
    if (!(downloadId && promptId) || downloadId.length > 256 || promptId.length > 256) {
      throw new Error('Invalid thread identity')
    }
    const row = this.db
      .prepare(
        'SELECT id FROM agent_threads WHERE download_id = ? AND prompt_id = ? ORDER BY rowid LIMIT 1'
      )
      .get(downloadId, promptId) as { id: string } | undefined
    if (row) {
      const thread = this.get(row.id)
      if (!thread) {
        throw new Error('Agent thread is missing')
      }
      return thread
    }
    const thread: AgentThread = {
      id: randomUUID(),
      downloadId,
      promptId,
      leafId: null,
      seq: 0,
      messages: [],
      runs: [],
      artifacts: []
    }
    const legacy = loadPersistedPromptRun(downloadId, promptId)
    if (legacy) {
      const id = randomUUID()
      const runId = randomUUID()
      thread.messages.push({
        id,
        runId,
        parentId: null,
        role: 'assistant',
        text: legacy.text,
        thinking: legacy.thinking,
        thinkingMs: legacy.thinkingMs,
        createdAt: legacy.updatedAt,
        legacy: true
      })
      thread.runs.push({
        id: runId,
        messageId: id,
        status:
          legacy.status === 'idle' || legacy.status === 'running' ? 'interrupted' : legacy.status,
        error: legacy.error,
        model: 'legacy',
        instruction: '',
        createdAt: legacy.updatedAt,
        updatedAt: legacy.updatedAt,
        rawMessages: [],
        tools: [],
        cloudResultId: legacy.cloudResultId
      })
      thread.leafId = id
    }
    this.save(thread, 'thread.created')
    return thread
  }

  /**
   * Always start a new conversation for this video and agent.
   *
   * @param downloadId Source video id.
   * @param promptId Prompt or freeform chat id.
   */
  create(downloadId: string, promptId: string): AgentThread {
    if (!(downloadId && promptId) || downloadId.length > 256 || promptId.length > 256) {
      throw new Error('Invalid thread identity')
    }
    const thread: AgentThread = {
      id: randomUUID(),
      downloadId,
      promptId,
      leafId: null,
      seq: 0,
      messages: [],
      runs: [],
      artifacts: []
    }
    this.save(thread, 'thread.created')
    return thread
  }

  /** Reuse an unused blank chat on this video instead of creating another empty thread. */
  findEmptyChat(downloadId: string, promptId: string): AgentThread | null {
    const rows = this.db
      .prepare(
        'SELECT id FROM agent_threads WHERE download_id = ? AND prompt_id = ? ORDER BY rowid'
      )
      .all(downloadId, promptId) as { id: string }[]
    for (const row of rows) {
      const thread = this.get(row.id)
      if (thread && thread.messages.length === 0) {
        return thread
      }
    }
    return null
  }

  /** Rebuild agent_threads without UNIQUE(download_id, prompt_id) so one video can keep many chats. */
  private dropLegacyThreadUniqueness(): void {
    const table = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_threads'")
      .get() as { sql: string } | undefined
    if (!table?.sql.toUpperCase().includes('UNIQUE')) {
      return
    }
    this.db.exec(`PRAGMA foreign_keys=OFF;
      CREATE TABLE agent_threads_new (
        id TEXT PRIMARY KEY,
        download_id TEXT NOT NULL,
        prompt_id TEXT NOT NULL,
        data TEXT NOT NULL
      );
      INSERT INTO agent_threads_new (id, download_id, prompt_id, data)
        SELECT id, download_id, prompt_id, data FROM agent_threads;
      DROP TABLE agent_threads;
      ALTER TABLE agent_threads_new RENAME TO agent_threads;
      CREATE INDEX IF NOT EXISTS agent_threads_download_prompt ON agent_threads (download_id, prompt_id);
      PRAGMA foreign_keys=ON;`)
  }

  /** Restore typed entities from their independent durable records. */
  get(id: string): AgentThread | null {
    const row = this.db.prepare('SELECT data FROM agent_threads WHERE id = ?').get(id) as
      | { data: string }
      | undefined
    if (!row) {
      return null
    }
    const thread = JSON.parse(row.data) as AgentThread
    thread.messages = this.db
      .prepare('SELECT data FROM agent_messages WHERE thread_id = ? ORDER BY rowid')
      .all(id)
      .map((item) => JSON.parse((item as { data: string }).data))
    thread.artifacts = this.db
      .prepare('SELECT data FROM agent_artifacts WHERE thread_id = ? ORDER BY rowid')
      .all(id)
      .map((item) => JSON.parse((item as { data: string }).data))
    thread.runs = this.db
      .prepare('SELECT data FROM agent_runs WHERE thread_id = ? ORDER BY rowid')
      .all(id)
      .map((item) => {
        const run = JSON.parse((item as { data: string }).data) as AgentChatRun
        const entries = this.db
          .prepare('SELECT data FROM agent_run_entries WHERE run_id = ? ORDER BY seq')
          .all(run.id) as { data: string }[]
        if (entries.length) {
          run.sessionEntries = entries.map((entry) =>
            rehydrateEntry(JSON.parse(entry.data) as SessionEntry, thread.artifacts)
          )
        }
        return run
      })
    return thread
  }

  /** Commit entities and a sequenced event atomically before broadcasting. */
  save(
    thread: AgentThread,
    type: string,
    runId: string | null = null,
    scope?: SaveScope
  ): AgentRunEvent {
    const nextSeq = thread.seq + 1
    const event: AgentRunEvent = {
      threadId: thread.id,
      runId,
      messageId: runId ? (thread.runs.find((run) => run.id === runId)?.messageId ?? null) : null,
      seq: nextSeq,
      type,
      createdAt: Date.now(),
      snapshot: publicAgentThread({ ...thread, seq: nextSeq })
    }
    const writeAll = !scope
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO agent_threads VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'
        )
        .run(
          thread.id,
          thread.downloadId,
          thread.promptId,
          JSON.stringify({
            ...thread,
            seq: nextSeq,
            messages: [],
            runs: [],
            artifacts: []
          })
        )
      const putMessage = this.db.prepare(
        'INSERT INTO agent_messages VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'
      )
      const putRun = this.db.prepare(
        'INSERT INTO agent_runs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'
      )
      const putArtifact = this.db.prepare(
        'INSERT INTO agent_artifacts VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'
      )
      const messages = writeAll
        ? thread.messages
        : thread.messages.filter((message) => scope.messageIds?.includes(message.id))
      for (const message of messages) {
        putMessage.run(message.id, thread.id, JSON.stringify(message))
      }
      const runs = writeAll
        ? thread.runs
        : thread.runs.filter((run) => scope.runIds?.includes(run.id))
      for (const run of runs) {
        const storedEntries = this.db
          .prepare('SELECT COUNT(*) AS n FROM agent_run_entries WHERE run_id = ?')
          .get(run.id) as { n: number }
        const keepRaw =
          storedEntries.n === 0 &&
          Array.isArray(run.rawMessages) &&
          run.rawMessages.length > 0 &&
          !run.sessionEntries?.length
        putRun.run(run.id, thread.id, JSON.stringify(persistableRun(run, keepRaw)))
        this.appendRunEntries(run, thread.artifacts, storedEntries.n)
      }
      const artifacts = writeAll
        ? thread.artifacts
        : thread.artifacts.filter((artifact) => scope.artifactIds?.includes(artifact.id))
      for (const artifact of artifacts) {
        putArtifact.run(artifact.id, thread.id, JSON.stringify(artifact))
      }
      this.db
        .prepare('INSERT INTO agent_events VALUES (?, ?, ?)')
        .run(thread.id, event.seq, JSON.stringify({ ...event, snapshot: undefined }))
    })()
    thread.seq = nextSeq
    return event
  }

  /**
   * Drop old cursor rows while keeping the latest snapshot for reconnect repair.
   *
   * @param thread Conversation whose event log should be trimmed.
   */
  pruneEvents(thread: AgentThread): void {
    const cutoff = thread.seq - EVENT_RETENTION
    if (cutoff <= 0) {
      return
    }
    this.db
      .prepare('DELETE FROM agent_events WHERE thread_id = ? AND seq <= ?')
      .run(thread.id, cutoff)
  }

  /** Read the durable cursor log; the current snapshot repairs any missed UI updates. */
  events(
    id: string,
    after: number
  ): { events: Omit<AgentRunEvent, 'snapshot'>[]; snapshot: AgentThread | null } {
    const events = this.db
      .prepare(
        'SELECT data FROM agent_events WHERE thread_id = ? AND seq > ? ORDER BY seq LIMIT 500'
      )
      .all(id, after)
      .map((row) => JSON.parse((row as { data: string }).data))
    const thread = this.get(id)
    return { events, snapshot: thread ? publicAgentThread(thread) : null }
  }

  /** Enumerate existing threads without creating new ones during deletion. */
  listVideo(downloadId: string): string[] {
    return (
      this.db
        .prepare('SELECT id FROM agent_threads WHERE download_id = ? ORDER BY rowid')
        .all(downloadId) as {
        id: string
      }[]
    ).map((row) => row.id)
  }

  /** All conversations for one video, including unused blank chats. */
  listVideoThreads(downloadId: string): AgentThread[] {
    const threads: AgentThread[] = []
    for (const id of this.listVideo(downloadId)) {
      const thread = this.get(id)
      if (thread) {
        threads.push(thread)
      }
    }
    return threads
  }

  /** Remove product state when its source video is deleted. */
  deleteVideo(downloadId: string): void {
    this.db.prepare('DELETE FROM agent_threads WHERE download_id = ?').run(downloadId)
  }

  /** Conversations with messages or selected image drafts, for the history drawer. */
  listHistory(): AgentThread[] {
    const rows = this.db.prepare('SELECT id FROM agent_threads').all() as { id: string }[]
    const threads: AgentThread[] = []
    for (const row of rows) {
      const thread = this.get(row.id)
      if (thread && (thread.messages.length > 0 || thread.images?.length)) {
        threads.push(thread)
      }
    }
    return threads
  }

  /** Set a conversation tab title without changing its messages. */
  rename(id: string, title: string): AgentThread {
    const thread = this.get(id)
    if (!thread) {
      throw new Error('Unknown conversation')
    }
    const next = sanitizeAgentConversationTitle(title)
    if (!next) {
      throw new Error('Title is empty')
    }
    thread.title = next
    this.save(thread, 'thread.renamed')
    return thread
  }

  /** Remove one conversation without deleting its source video. */
  deleteThread(id: string): void {
    this.db.prepare('DELETE FROM agent_threads WHERE id = ?').run(id)
  }

  /**
   * Insert only new append-only session entries for a run.
   *
   * @param run Live run whose in-memory sessionEntries may have grown.
   * @param artifacts Conversation artifacts used to dehydrate images.
   * @param persistedCount Rows already stored for this run.
   */
  private appendRunEntries(
    run: AgentChatRun,
    artifacts: AgentArtifact[],
    persistedCount: number
  ): void {
    const entries = (run.sessionEntries as SessionEntry[] | undefined) ?? []
    if (entries.length <= persistedCount) {
      return
    }
    const insert = this.db.prepare(
      'INSERT INTO agent_run_entries (run_id, seq, data) VALUES (?, ?, ?)'
    )
    for (let seq = persistedCount; seq < entries.length; seq += 1) {
      insert.run(run.id, seq, JSON.stringify(dehydrateEntry(entries[seq], artifacts)))
    }
  }

  /** Move sessionEntries out of run.data into agent_run_entries once. */
  private migrateToEntryStorage(): void {
    const row = this.db.prepare('SELECT value FROM agent_schema WHERE key = ?').get('version') as
      | { value: number }
      | undefined
    if ((row?.value ?? 0) >= 2) {
      return
    }
    const runs = this.db.prepare('SELECT id, data FROM agent_runs').all() as {
      id: string
      data: string
    }[]
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO agent_run_entries (run_id, seq, data) VALUES (?, ?, ?)'
    )
    const update = this.db.prepare('UPDATE agent_runs SET data = ? WHERE id = ?')
    for (const run of runs) {
      const data = JSON.parse(run.data) as AgentChatRun
      const entries = data.sessionEntries as SessionEntry[] | undefined
      const raw = data.rawMessages
      if (entries?.length) {
        for (const [seq, entry] of entries.entries()) {
          insert.run(run.id, seq, JSON.stringify(entry))
        }
        update.run(
          JSON.stringify(persistableRun({ ...data, sessionEntries: undefined }, false)),
          run.id
        )
      } else if (Array.isArray(raw) && raw.length) {
        update.run(JSON.stringify(persistableRun(data, true)), run.id)
      } else if (data.sessionEntries) {
        update.run(JSON.stringify(persistableRun(data, false)), run.id)
      }
    }
    this.db
      .prepare(
        'INSERT INTO agent_schema(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run('version', 2)
  }
}

/** Strip provider-private state and local paths from IPC snapshots. */
export function publicAgentThread(thread: AgentThread): AgentThread {
  return {
    ...thread,
    messages: thread.messages.map((message) => ({ ...message })),
    runs: thread.runs.map((run) => ({
      ...run,
      activity: agentActivity(run),
      rawMessages: [],
      workingNotes: undefined,
      sessionEntries: undefined,
      evidenceCoverage: undefined,
      evidenceSource: undefined,
      fullSourceReview: undefined,
      articleSections: undefined,
      contextCheckpoint: undefined,
      contextSummary: undefined,
      tools: run.tools.map((tool) => ({ ...tool }))
    })),
    artifacts: thread.artifacts.map((artifact) => ({
      ...artifact,
      path: '',
      posterPath: undefined
    })),
    images: thread.images?.map((image) => ({ ...image, path: '' }))
  }
}
let store: AgentChatStore | undefined
/** Return the single process-wide product store. */
export function getAgentChatStore(): AgentChatStore {
  store ??= new AgentChatStore(getDatabaseConnection().sqlite)
  return store
}
