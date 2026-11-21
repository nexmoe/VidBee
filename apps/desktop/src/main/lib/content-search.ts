import { setImmediate } from 'node:timers/promises'
import { captionLanguageKey } from '@vidbee/transcription'
import type { Database } from 'better-sqlite3'
import {
  CONTENT_SEARCH_MAX_PAGE_SIZE,
  CONTENT_SEARCH_QUERY_LIMIT,
  CONTENT_SEARCH_RESULT_LIMIT,
  type ContentSearchPage,
  type ContentSearchResults,
  emptyContentSearchResults
} from '../../shared/content-search'

const BATCH_SIZE = 128
const SNIPPET_LENGTH = 200

interface SearchRow {
  cursor: number
  text: string
}

interface TranscriptRow extends SearchRow {
  downloadId: string
  transcriptId: string
  segmentId: string
  language: string | null
  sourceKind: string | null
  startMs: number
}

interface ChatRow extends SearchRow {
  downloadId: string
  promptId: string
  threadId: string
  messageId: string
  title: string | null
}

const TRANSCRIPT_SEARCH_SQL = `
  SELECT s.rowid AS cursor, s.text, s.id AS segmentId, s.start_ms AS startMs,
         t.id AS transcriptId, t.download_task_id AS downloadId,
         t.language, t.source_kind AS sourceKind
  FROM transcript_segments s JOIN transcripts t ON t.id = s.transcript_id
  WHERE s.rowid < ? AND t.result_kind = 'transcript'
    AND NOT EXISTS (
      SELECT 1 FROM transcripts newer
      WHERE newer.download_task_id = t.download_task_id AND newer.result_kind = 'transcript'
        AND coalesce(newer.source_kind, 'asr') = coalesce(t.source_kind, 'asr')
        AND (coalesce(t.source_kind, 'asr') != 'captions'
             OR coalesce(newer.language, 'und') = coalesce(t.language, 'und'))
        AND (newer.created_at > t.created_at
             OR (newer.created_at = t.created_at AND newer.rowid > t.rowid))
    )
  ORDER BY s.rowid DESC LIMIT ?`

const CHAT_SEARCH_SQL = `
  SELECT m.rowid AS cursor, json_extract(m.data, '$.text') AS text,
         m.id AS messageId, t.id AS threadId, t.download_id AS downloadId,
         t.prompt_id AS promptId,
         coalesce(nullif(json_extract(t.data, '$.title'), ''),
                  json_extract(t.data, '$.directory.userText'), '') AS title
  FROM agent_messages m JOIN agent_threads t ON t.id = m.thread_id
  WHERE m.rowid < ? AND json_extract(m.data, '$.role') IN ('user', 'assistant')
  ORDER BY m.rowid DESC LIMIT ?`

/** Keep query text literal, Unicode-aware, and consistent with metadata matching. */
export function contentSearchWords(query: string): string[] {
  if (typeof query !== 'string' || query.length > CONTENT_SEARCH_QUERY_LIMIT) {
    throw new Error('Invalid content search query')
  }
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

/** Return bounded context around the first matching term, including matches late in a body. */
export function contentSearchSnippet(text: string, words: readonly string[]): string {
  const normalized = text.replace(/\s+/g, ' ')
  const lower = normalized.toLowerCase()
  const first = Math.min(...words.map((word) => lower.indexOf(word)).filter((index) => index >= 0))
  const start = Math.max(0, (Number.isFinite(first) ? first : 0) - 60)
  const end = Math.min(normalized.length, start + SNIPPET_LENGTH)
  return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`
}

/** Scan public text in small pages, yielding so downloads and newer searches can proceed. */
async function matchingRows<T extends SearchRow>(
  db: Database,
  sql: string,
  words: readonly string[],
  page: ContentSearchPage,
  signal?: AbortSignal
): Promise<T[]> {
  const statement = db.prepare(sql)
  const hits: T[] = []
  let cursor = Number.MAX_SAFE_INTEGER
  let skipped = 0
  while (!signal?.aborted && hits.length <= page.limit) {
    const rows = statement.all(cursor, BATCH_SIZE) as T[]
    if (!rows.length) {
      break
    }
    for (const row of rows) {
      cursor = row.cursor
      if (typeof row.text !== 'string') {
        continue
      }
      const text = row.text.toLowerCase()
      if (words.every((word) => text.includes(word))) {
        if (skipped < page.offset) {
          skipped += 1
          continue
        }
        hits.push(row)
        if (hits.length > page.limit) {
          break
        }
      }
    }
    await setImmediate()
  }
  return hits
}

/** Search persisted caption tracks and public conversation messages without hydrating histories. */
export async function searchContent(
  db: Database,
  query: string,
  signal?: AbortSignal,
  page: ContentSearchPage = { offset: 0, limit: CONTENT_SEARCH_RESULT_LIMIT }
): Promise<ContentSearchResults> {
  const words = contentSearchWords(query)
  if (
    !Number.isSafeInteger(page.offset) ||
    page.offset < 0 ||
    !Number.isInteger(page.limit) ||
    page.limit < 1 ||
    page.limit > CONTENT_SEARCH_MAX_PAGE_SIZE
  ) {
    throw new Error('Invalid content search page')
  }
  if (!words.length || signal?.aborted) {
    return emptyContentSearchResults()
  }
  const transcripts = await matchingRows<TranscriptRow>(
    db,
    TRANSCRIPT_SEARCH_SQL,
    words,
    page,
    signal
  )
  const messages = await matchingRows<ChatRow>(db, CHAT_SEARCH_SQL, words, page, signal)
  if (signal?.aborted) {
    return emptyContentSearchResults()
  }
  return {
    hasMore: transcripts.length > page.limit || messages.length > page.limit,
    transcripts: transcripts.slice(0, page.limit).map((row) => ({
      downloadId: row.downloadId,
      transcriptId: row.transcriptId,
      segmentId: row.segmentId,
      sourceKey:
        row.sourceKind === 'captions' ? `captions:${captionLanguageKey(row.language)}` : 'asr',
      startMs: row.startMs,
      snippet: contentSearchSnippet(row.text, words)
    })),
    messages: messages.slice(0, page.limit).map((row) => ({
      downloadId: row.downloadId,
      promptId: row.promptId,
      threadId: row.threadId,
      messageId: row.messageId,
      title: (row.title ?? '').slice(0, 120),
      snippet: contentSearchSnippet(row.text, words)
    }))
  }
}
