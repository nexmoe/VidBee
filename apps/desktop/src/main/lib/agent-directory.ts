import type { Database } from 'better-sqlite3'
import {
  type AgentChatMessage,
  type AgentChatRun,
  type AgentImageAttachment,
  type AgentRunStatus,
  type AgentThread,
  selectedAgentMessages
} from '../../shared/agent-chat'
import { agentThreadIsRunning, agentThreadUpdatedAt } from '../../shared/agent-history'

/** Small header stored on the thread row so directory lists do not parse runs. */
interface AgentDirectoryMeta {
  hasHistory: boolean
  running: boolean
  updatedAt: number
  userText: string
}

interface HeaderRow {
  id: string
  download_id: string
  prompt_id: string
  data: string
}

const RUN_STATUSES = new Set<AgentRunStatus>([
  'running',
  'completed',
  'aborted',
  'error',
  'interrupted'
])

/**
 * Directory fields computed from the in-memory thread at save time.
 *
 * @param thread Conversation being committed.
 */
export function agentDirectoryMeta(thread: AgentThread): AgentDirectoryMeta {
  return {
    hasHistory: thread.messages.length > 0 || Boolean(thread.images?.length),
    running: agentThreadIsRunning(thread),
    updatedAt: agentThreadUpdatedAt(thread),
    userText: firstUserLine(thread)
  }
}

/**
 * Conversations described by thread headers. Run and artifact payloads are not read.
 *
 * @param db Open desktop database.
 * @param downloadId When set, only that video's conversations are returned.
 */
export function readDirectoryThreads(db: Database, downloadId?: string): AgentThread[] {
  const statement = downloadId
    ? db.prepare(
        `SELECT id, download_id, prompt_id, data FROM agent_threads
         WHERE download_id = ? ORDER BY rowid`
      )
    : db.prepare('SELECT id, download_id, prompt_id, data FROM agent_threads ORDER BY rowid')
  const rows = (downloadId ? statement.all(downloadId) : statement.all()) as HeaderRow[]
  return rows.map((row) => threadFromHeader(db, row))
}

/**
 * One prompt's selected answer, without loading every run or artifact body.
 *
 * @param db Open desktop database.
 * @param downloadId Video that owns the prompt.
 * @param promptId Prompt whose newest thread should be projected.
 */
export function readPromptThreadView(
  db: Database,
  downloadId: string,
  promptId: string
): AgentThread | null {
  const header = db
    .prepare(
      `SELECT id, download_id, prompt_id, data FROM agent_threads
       WHERE download_id = ? AND prompt_id = ? ORDER BY rowid LIMIT 1`
    )
    .get(downloadId, promptId) as HeaderRow | undefined
  if (!header) {
    return null
  }
  const data = JSON.parse(header.data) as { leafId?: string | null; seq?: number; title?: string }
  const links = db
    .prepare(
      `SELECT json_extract(data, '$.id') AS id,
              json_extract(data, '$.parentId') AS parentId,
              json_extract(data, '$.role') AS role,
              json_extract(data, '$.runId') AS runId,
              json_extract(data, '$.createdAt') AS createdAt
       FROM agent_messages WHERE thread_id = ? ORDER BY rowid`
    )
    .all(header.id) as Record<string, unknown>[]
  const thread: AgentThread = {
    id: header.id,
    downloadId: header.download_id,
    promptId: header.prompt_id,
    leafId: data.leafId ?? null,
    seq: typeof data.seq === 'number' ? data.seq : 0,
    title: data.title,
    messages: links.flatMap(linkMessage),
    runs: [],
    artifacts: []
  }
  const assistant = [...selectedAgentMessages(thread)]
    .reverse()
    .find((message) => message.role === 'assistant')
  if (!assistant) {
    return thread
  }
  const body = db
    .prepare(
      `SELECT json_extract(data, '$.text') AS text,
              json_extract(data, '$.thinking') AS thinking,
              json_extract(data, '$.thinkingMs') AS thinkingMs
       FROM agent_messages WHERE id = ?`
    )
    .get(assistant.id) as Record<string, unknown> | undefined
  assistant.text = typeof body?.text === 'string' ? body.text : ''
  assistant.thinking = typeof body?.thinking === 'string' ? body.thinking : ''
  if (typeof body?.thinkingMs === 'number') {
    assistant.thinkingMs = body.thinkingMs
  }
  const run = assistant.runId ? statusRun(db, assistant.runId, assistant.id) : undefined
  if (run) {
    thread.runs = [run]
  }
  return thread
}

/**
 * First user line used as a chat title. Image names stay on the header images.
 *
 * @param thread Conversation whose messages are already in memory.
 */
function firstUserLine(thread: AgentThread): string {
  for (const message of thread.messages) {
    if (message.role !== 'user') {
      continue
    }
    const line = message.text.trim().split('\n')[0]?.trim() ?? ''
    if (line) {
      return line.slice(0, 80)
    }
  }
  return ''
}

/**
 * Build a summary thread from the header, falling back to column extracts for old rows.
 *
 * @param db Open desktop database.
 * @param row Thread header row.
 */
function threadFromHeader(db: Database, row: HeaderRow): AgentThread {
  const data = JSON.parse(row.data) as {
    leafId?: string | null
    seq?: number
    title?: string
    images?: AgentImageAttachment[]
    directory?: unknown
  }
  const meta = metaFrom(data.directory) ?? legacyMeta(db, row.id, data.images)
  return directoryThread(row, data, meta)
}

/**
 * Accept only a complete directory object written by a current save.
 *
 * @param value Parsed header field.
 */
function metaFrom(value: unknown): AgentDirectoryMeta | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const meta = value as AgentDirectoryMeta
  if (typeof meta.hasHistory !== 'boolean' || typeof meta.running !== 'boolean') {
    return null
  }
  if (typeof meta.updatedAt !== 'number' || typeof meta.userText !== 'string') {
    return null
  }
  return meta
}

/**
 * Old thread rows have no directory object. Read status columns, not run bodies.
 *
 * @param db Open desktop database.
 * @param threadId Thread whose child rows supply the fallback.
 * @param images Images already stored on the thread header.
 */
function legacyMeta(
  db: Database,
  threadId: string,
  images: AgentImageAttachment[] | undefined
): AgentDirectoryMeta {
  const messages = db
    .prepare('SELECT count(*) AS n FROM agent_messages WHERE thread_id = ?')
    .get(threadId) as { n: unknown }
  const running = db
    .prepare(
      `SELECT 1 AS n FROM agent_runs
       WHERE thread_id = ? AND json_extract(data, '$.status') = 'running' LIMIT 1`
    )
    .get(threadId) as { n: unknown } | undefined
  const messageAt = db
    .prepare(
      `SELECT max(json_extract(data, '$.createdAt')) AS n FROM agent_messages WHERE thread_id = ?`
    )
    .get(threadId) as { n: unknown }
  const runAt = db
    .prepare(
      `SELECT max(json_extract(data, '$.updatedAt')) AS n FROM agent_runs WHERE thread_id = ?`
    )
    .get(threadId) as { n: unknown }
  const users = db
    .prepare(
      `SELECT json_extract(data, '$.text') AS text FROM agent_messages
       WHERE thread_id = ? AND json_extract(data, '$.role') = 'user' ORDER BY rowid`
    )
    .all(threadId) as Array<{ text: unknown }>
  let userText = ''
  for (const user of users) {
    const line =
      typeof user.text === 'string' ? (user.text.trim().split('\n')[0]?.trim() ?? '') : ''
    if (!line) {
      continue
    }
    userText = line.slice(0, 80)
    break
  }
  const imageAt = Math.max(0, ...(images ?? []).map((image) => image.createdAt))
  return {
    hasHistory: asNumber(messages.n) > 0 || Boolean(images?.length),
    running: Boolean(running),
    updatedAt: Math.max(asNumber(messageAt.n), asNumber(runAt.n), imageAt),
    userText
  }
}

/**
 * Thread shape the existing summary helpers already understand.
 *
 * @param row Identity columns.
 * @param header Parsed thread header.
 * @param meta Directory projection.
 */
function directoryThread(
  row: HeaderRow,
  header: { leafId?: string | null; seq?: number; title?: string; images?: AgentImageAttachment[] },
  meta: AgentDirectoryMeta
): AgentThread {
  const messages: AgentChatMessage[] = []
  if (meta.userText) {
    messages.push(previewMessage(row.id, 'user', meta.userText, meta.updatedAt))
  } else if (meta.hasHistory && !header.images?.length) {
    messages.push(previewMessage(row.id, 'assistant', '', meta.updatedAt))
  }
  return {
    id: row.id,
    downloadId: row.download_id,
    promptId: row.prompt_id,
    leafId: header.leafId ?? null,
    seq: typeof header.seq === 'number' ? header.seq : 0,
    title: header.title,
    messages,
    runs: meta.running || meta.updatedAt > 0 ? [directoryRun(meta)] : [],
    artifacts: [],
    images: header.images
  }
}

/**
 * One stand-in message so history membership and titles keep working.
 *
 * @param threadId Conversation id.
 * @param role User preview or empty assistant placeholder.
 * @param text First user line, or empty when the thread has no user text.
 * @param createdAt Directory timestamp.
 */
function previewMessage(
  threadId: string,
  role: 'user' | 'assistant',
  text: string,
  createdAt: number
): AgentChatMessage {
  return {
    id: `${threadId}:${role === 'user' ? 'preview' : 'history'}`,
    parentId: null,
    runId: null,
    role,
    text,
    thinking: '',
    createdAt
  }
}

/**
 * One stand-in run carrying running state and the directory timestamp.
 *
 * @param meta Header projection.
 */
function directoryRun(meta: AgentDirectoryMeta): AgentChatRun {
  return {
    id: 'directory',
    messageId: '',
    status: meta.running ? 'running' : 'completed',
    error: null,
    model: '',
    instruction: '',
    createdAt: meta.updatedAt,
    updatedAt: meta.updatedAt,
    rawMessages: [],
    tools: []
  }
}

/**
 * Identity fields for one stored message. Text stays empty until a selected answer needs it.
 *
 * @param row Extracted message columns.
 */
function linkMessage(row: Record<string, unknown>): AgentChatMessage[] {
  if (typeof row.id !== 'string' || (row.role !== 'user' && row.role !== 'assistant')) {
    return []
  }
  return [
    {
      id: row.id,
      parentId: typeof row.parentId === 'string' ? row.parentId : null,
      runId: typeof row.runId === 'string' ? row.runId : null,
      role: row.role,
      text: '',
      thinking: '',
      createdAt: asNumber(row.createdAt)
    }
  ]
}

/**
 * Status fields of one run. The stored JSON body is not returned.
 *
 * @param db Open desktop database.
 * @param runId Run linked from the selected assistant.
 * @param messageId Assistant message that owns the run.
 */
function statusRun(db: Database, runId: string, messageId: string): AgentChatRun | undefined {
  const row = db
    .prepare(
      `SELECT json_extract(data, '$.status') AS status,
              json_extract(data, '$.error') AS error,
              json_extract(data, '$.updatedAt') AS updatedAt,
              json_extract(data, '$.createdAt') AS createdAt
       FROM agent_runs WHERE id = ?`
    )
    .get(runId) as Record<string, unknown> | undefined
  if (!row || typeof row.status !== 'string' || !RUN_STATUSES.has(row.status as AgentRunStatus)) {
    return undefined
  }
  return {
    id: runId,
    messageId,
    status: row.status as AgentRunStatus,
    error: typeof row.error === 'string' ? row.error : null,
    model: '',
    instruction: '',
    createdAt: asNumber(row.createdAt),
    updatedAt: asNumber(row.updatedAt),
    rawMessages: [],
    tools: []
  }
}

/**
 * SQLite counts and JSON numbers, including the bigint form some drivers return.
 *
 * @param value Raw SQL value.
 */
function asNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'bigint') {
    return Number(value)
  }
  return 0
}
