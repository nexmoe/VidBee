import { createHash } from 'node:crypto'
import { getDatabaseConnection } from './database'

/** Admit each browser action once, including after reconnecting or restarting Desktop. */
export function admitExtensionChatRequest(
  origin: string,
  requestId: string,
  command: unknown,
  admit: () => string
): string {
  const db = getDatabaseConnection().sqlite
  db.exec(`CREATE TABLE IF NOT EXISTS extension_chat_requests (
    origin TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL,
    thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
    PRIMARY KEY(origin, request_id))`)
  const digest = createHash('sha256').update(JSON.stringify(command)).digest('hex')
  return db.transaction(() => {
    const previous = db
      .prepare(
        'SELECT digest, thread_id FROM extension_chat_requests WHERE origin = ? AND request_id = ?'
      )
      .get(origin, requestId) as { digest: string; thread_id: string } | undefined
    if (previous) {
      if (previous.digest !== digest) {
        throw new Error('Request identity changed')
      }
      return previous.thread_id
    }
    const threadId = admit()
    db.prepare(
      'INSERT INTO extension_chat_requests (origin, request_id, digest, thread_id) VALUES (?, ?, ?, ?)'
    ).run(origin, requestId, digest, threadId)
    return threadId
  })()
}
