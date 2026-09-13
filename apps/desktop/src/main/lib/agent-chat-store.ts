import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { AgentRunEvent, AgentThread } from '../../shared/agent-chat'
import { sanitizeAgentConversationTitle } from '../../shared/agent-history'
import { agentActivity } from './agent-activity'
import { agentAnswer } from './agent-output'
import { loadPersistedPromptRun } from './ai-prompt-store'
import { getDatabaseConnection } from './database'

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
      CREATE INDEX IF NOT EXISTS agent_threads_download_prompt ON agent_threads (download_id, prompt_id);`)
    this.dropLegacyThreadUniqueness()
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
          if (tool.status === 'running') {
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
    for (const [key, table] of [
      ['messages', 'agent_messages'],
      ['runs', 'agent_runs'],
      ['artifacts', 'agent_artifacts']
    ] as const) {
      thread[key] = this.db
        .prepare(`SELECT data FROM ${table} WHERE thread_id = ? ORDER BY rowid`)
        .all(id)
        .map((item) => JSON.parse((item as { data: string }).data))
    }
    return thread
  }

  /** Commit entities and a sequenced event atomically before broadcasting. */
  save(thread: AgentThread, type: string, runId: string | null = null): AgentRunEvent {
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
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO agent_threads VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'
        )
        .run(
          thread.id,
          thread.downloadId,
          thread.promptId,
          JSON.stringify({ ...thread, seq: nextSeq, messages: [], runs: [], artifacts: [] })
        )
      for (const [key, table] of [
        ['messages', 'agent_messages'],
        ['runs', 'agent_runs'],
        ['artifacts', 'agent_artifacts']
      ] as const) {
        const put = this.db.prepare(
          `INSERT INTO ${table} VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`
        )
        for (const item of thread[key]) {
          put.run(item.id, thread.id, JSON.stringify(item))
        }
      }
      this.db
        .prepare('INSERT INTO agent_events VALUES (?, ?, ?)')
        .run(thread.id, event.seq, JSON.stringify({ ...event, snapshot: undefined }))
    })()
    thread.seq = nextSeq
    return event
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
}

/** Strip provider-private state and local paths from IPC snapshots. */
export function publicAgentThread(thread: AgentThread): AgentThread {
  return {
    ...thread,
    messages: thread.messages.map((message) => {
      const run = thread.runs.find((item) => item.id === message.runId)
      if (message.role !== 'assistant' || !run || message.legacy) {
        return { ...message }
      }
      return {
        ...message,
        text:
          run.status !== 'completed' && run.rawMessages.length && !run.articleSections?.length
            ? agentAnswer(run.rawMessages)
            : message.text
      }
    }),
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
