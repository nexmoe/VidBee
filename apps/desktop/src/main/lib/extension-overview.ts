import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isDownloadTaskKind } from '@vidbee/task-queue'
import { AI_OVERVIEW_PROMPT_ID } from '../../shared/ai-prompts'
import type { AiPromptRunSnapshot } from '../../shared/ai-types'
import type {
  ExtensionOverviewInput,
  ExtensionOverviewSnapshot
} from '../../shared/extension-overview'
import {
  isReusableOverviewSnapshot,
  type OverviewDownloadMatch,
  resolveExtensionOverviewTarget,
  snapshotFromOverviewThread
} from '../../shared/extension-overview-reuse'
import { isExtensionSourceUrl } from '../../shared/extension-source-url'
import { getAgentChatStore } from './agent-chat-store'
import {
  getPromptRunSnapshot,
  startPromptRun,
  stopPromptRun,
  stopPromptRunsForDownload
} from './ai-prompt-runner'
import { applyExtensionCors, extensionRequestOrigin, replyExtensionJson } from './extension-origin'
import { peekDesktopTaskQueueRef } from './queue-ref'

const PREFIX = '/extension/v1/overview'
const TTL_MS = 60 * 60 * 1000
const MAX_JOBS = 32
const REQUEST_ID = /^[a-f0-9-]{36}$/i
interface Job {
  digest: string
  downloadId: string
  reused: boolean
  expiresAt: number
  origin: string
  token: string
}
const jobs = new Map<string, Job>()

/** Recognize only this API namespace before the legacy GET-only dispatcher. */
export function isExtensionOverviewPath(pathname: string): boolean {
  return pathname === PREFIX || pathname.startsWith(`${PREFIX}/`)
}

/** Permit browser extension callers, never ordinary website origins. */
function requestOrigin(req: IncomingMessage): string | null {
  return extensionRequestOrigin(req)
}

/** Return a private, non-cacheable JSON response to the initiating extension. */
function reply(res: ServerResponse, status: number, body: unknown): void {
  replyExtensionJson(res, status, body)
}

/** Bound caption input before allocating a Desktop prompt run. */
async function readInput(req: IncomingMessage): Promise<ExtensionOverviewInput | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > 2_000_000) {
      return null
    }
    chunks.push(buffer)
  }
  let input: ExtensionOverviewInput
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ExtensionOverviewInput
  } catch {
    return null
  }
  if (
    !input ||
    typeof input.requestId !== 'string' ||
    !REQUEST_ID.test(input.requestId) ||
    typeof input.transcriptText !== 'string' ||
    !input.transcriptText.trim() ||
    input.transcriptText.length > 1_000_000 ||
    typeof input.sourceUrl !== 'string' ||
    input.sourceUrl.length > 2048
  ) {
    return null
  }
  if (!isExtensionSourceUrl(input.sourceUrl)) {
    return null
  }
  for (const language of [input.uiLanguage, input.transcriptLanguage]) {
    if (language !== undefined && (typeof language !== 'string' || language.length > 64)) {
      return null
    }
  }
  if (input.transcriptOrigin !== undefined && !['ai', 'human'].includes(input.transcriptOrigin)) {
    return null
  }
  if (input.forceRegenerate !== undefined && typeof input.forceRegenerate !== 'boolean') {
    return null
  }
  return input
}

/** Remove credentials and internal download identifiers from the wire result. */
function publicSnapshot(snapshot: AiPromptRunSnapshot): ExtensionOverviewSnapshot {
  return {
    status: snapshot.status,
    text: snapshot.text,
    error: snapshot.error,
    errorCode: snapshot.errorCode,
    thinking: snapshot.thinking,
    thinkingMs: snapshot.thinkingMs,
    updatedAt: snapshot.updatedAt
  }
}

/** Page local download history so an extension watch URL can attach to an existing task. */
function listDownloadMatches(): OverviewDownloadMatch[] {
  const queue = peekDesktopTaskQueueRef()
  if (!queue) {
    return []
  }
  const matches: OverviewDownloadMatch[] = []
  let cursor: string | null = null
  do {
    const page = queue.list({ limit: 200, cursor })
    for (const task of page.tasks) {
      if (isDownloadTaskKind(task.kind)) {
        matches.push({
          id: task.id,
          kind: task.kind,
          input: { url: task.input.url },
          updatedAt: task.updatedAt
        })
      }
    }
    cursor = page.nextCursor
  } while (cursor)
  return matches
}

/** Read the Desktop Overview the user already sees, without creating an empty thread. */
function liveOverviewSnapshot(downloadId: string): AiPromptRunSnapshot | null {
  try {
    const overview = getAgentChatStore()
      .listVideoThreads(downloadId)
      .find((thread) => thread.promptId === AI_OVERVIEW_PROMPT_ID)
    const fromAgent = overview ? snapshotFromOverviewThread(overview) : null
    if (fromAgent && isReusableOverviewSnapshot(fromAgent)) {
      return fromAgent
    }
  } catch {
    // Agent store is unavailable until Desktop SQLite is open.
  }
  const prompt = getPromptRunSnapshot(downloadId, AI_OVERVIEW_PROMPT_ID)
  return isReusableOverviewSnapshot(prompt) ? prompt : null
}

/** Re-read a reused Desktop Overview, otherwise the extension-owned prompt run. */
function jobSnapshot(job: Job): AiPromptRunSnapshot {
  if (job.reused) {
    return (
      liveOverviewSnapshot(job.downloadId) ??
      getPromptRunSnapshot(job.downloadId, AI_OVERVIEW_PROMPT_ID)
    )
  }
  return getPromptRunSnapshot(job.downloadId, AI_OVERVIEW_PROMPT_ID)
}

/** Release expired extension-only runs without aborting a reused Desktop Overview. */
function pruneJobs(): void {
  for (const [id, job] of jobs) {
    if (job.expiresAt > Date.now()) {
      continue
    }
    if (!job.reused) {
      stopPromptRunsForDownload(job.downloadId)
    }
    jobs.delete(id)
  }
}

/** Authenticate and dispatch Overview start, polling and cancellation to Desktop. */
export async function handleExtensionOverview(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  consumeToken: (token: string, origin: string) => boolean
): Promise<void> {
  const origin = requestOrigin(req)
  if (!origin) {
    reply(res, 403, { error: 'Extension origin required' })
    return
  }
  applyExtensionCors(res, origin)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  pruneJobs()
  const token = req.headers.authorization?.replace(/^Bearer /i, '') ?? ''
  if (pathname === PREFIX && req.method === 'POST') {
    if (!consumeToken(token, origin)) {
      reply(res, 401, { error: 'Invalid start token' })
      return
    }
    const input = await readInput(req)
    if (!input) {
      reply(res, 400, { error: 'Invalid overview input' })
      return
    }
    const id = createHash('sha256').update(`${origin}:${input.requestId}`).digest('hex')
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const existing = jobs.get(id)
    if (existing && existing.digest !== digest) {
      reply(res, 409, { error: 'Request identity changed' })
      return
    }
    const running = [...jobs.values()].filter((job) => jobSnapshot(job).status === 'running')
    if (!existing && (jobs.size >= MAX_JOBS || running.length >= 2)) {
      reply(res, 429, {
        error: 'Too many overview requests. Wait for a running overview to finish.'
      })
      return
    }
    if (existing) {
      reply(res, 200, {
        id,
        token: existing.token,
        snapshot: publicSnapshot(jobSnapshot(existing))
      })
      return
    }
    const target = resolveExtensionOverviewTarget({
      forceRegenerate: input.forceRegenerate === true,
      sourceUrl: input.sourceUrl,
      ephemeralDownloadId: `__extension-overview:${id}`,
      tasks: listDownloadMatches(),
      overviewFor: liveOverviewSnapshot
    })
    const job: Job = {
      digest,
      downloadId: target.downloadId,
      reused: target.reused,
      origin,
      token: randomBytes(32).toString('hex'),
      expiresAt: Date.now() + TTL_MS
    }
    jobs.set(id, job)
    const snapshot =
      target.snapshot ??
      startPromptRun({
        downloadId: job.downloadId,
        promptId: AI_OVERVIEW_PROMPT_ID,
        transcriptText: input.transcriptText,
        sourceUrl: input.sourceUrl,
        transcriptLanguage: input.transcriptLanguage,
        transcriptOrigin: input.transcriptOrigin,
        uiLanguage: input.uiLanguage ?? 'en'
      })
    reply(res, 200, { id, token: job.token, snapshot: publicSnapshot(snapshot) })
    return
  }
  const parts = pathname.slice(PREFIX.length + 1).split('/')
  const job = jobs.get(parts[0] ?? '')
  if (!job || job.origin !== origin || job.token !== token) {
    reply(res, 401, { error: 'Overview session expired' })
    return
  }
  if (parts.length === 1 && req.method === 'GET') {
    reply(res, 200, publicSnapshot(jobSnapshot(job)))
    return
  }
  if (parts.length === 2 && parts[1] === 'cancel' && req.method === 'POST') {
    reply(
      res,
      200,
      publicSnapshot(
        job.reused ? jobSnapshot(job) : stopPromptRun(job.downloadId, AI_OVERVIEW_PROMPT_ID)
      )
    )
    return
  }
  reply(res, 405, { error: 'Method not allowed' })
}

/** Stop extension-owned work when the local server shuts down. */
export function clearExtensionOverviews(): void {
  for (const job of jobs.values()) {
    if (!job.reused) {
      stopPromptRunsForDownload(job.downloadId)
    }
  }
  jobs.clear()
}
