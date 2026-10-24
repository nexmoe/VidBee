import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isExtensionSourceUrl } from '../../shared/extension-source-url'
import type {
  ExtensionTranscriptInput,
  ExtensionTranscriptSnapshot
} from '../../shared/extension-transcript'
import { applyExtensionCors, extensionRequestOrigin, replyExtensionJson } from './extension-origin'
import { emptyCaptionSnapshot, extractRemoteCaptions } from './remote-captions'

const PREFIX = '/extension/v1/transcript'
const TTL_MS = 30 * 60 * 1000
const MAX_JOBS = 16
const MAX_RUNNING = 2
const REQUEST_ID = /^[a-f0-9-]{36}$/i

interface Job {
  expiresAt: number
  language: string
  origin: string
  process: { kill: () => void } | null
  snapshot: ExtensionTranscriptSnapshot
  sourceUrl: string
  token: string
}

const jobs = new Map<string, Job>()

/** Recognize this API namespace before the GET-only dispatcher. */
export function isExtensionTranscriptPath(pathname: string): boolean {
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

/** Bound caption input before starting a Desktop extract. */
async function readInput(req: IncomingMessage): Promise<ExtensionTranscriptInput | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > 16_384) {
      return null
    }
    chunks.push(buffer)
  }
  let input: ExtensionTranscriptInput
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ExtensionTranscriptInput
  } catch {
    return null
  }
  if (
    !input ||
    typeof input.requestId !== 'string' ||
    !REQUEST_ID.test(input.requestId) ||
    typeof input.sourceUrl !== 'string' ||
    !isExtensionSourceUrl(input.sourceUrl)
  ) {
    return null
  }
  if (
    input.language !== undefined &&
    (typeof input.language !== 'string' || input.language.length > 64)
  ) {
    return null
  }
  if (input.refresh !== undefined && typeof input.refresh !== 'boolean') {
    return null
  }
  return input
}

/** Stop an in-flight extract without throwing. */
function stopJob(job: Job): void {
  try {
    job.process?.kill()
  } catch {
    /* The child may have already exited. */
  }
  job.process = null
}

/** Drop expired jobs and abort leftover yt-dlp children. */
function pruneJobs(): void {
  for (const [id, job] of jobs) {
    if (job.expiresAt > Date.now()) {
      continue
    }
    stopJob(job)
    jobs.delete(id)
  }
}

/** Start yt-dlp in the background and publish the snapshot when it finishes. */
function startExtract(job: Job): void {
  void extractRemoteCaptions(job.sourceUrl, {
    language: job.language,
    onProcess: (child) => {
      job.process = child
    }
  })
    .then((snapshot) => {
      job.process = null
      job.snapshot = snapshot
    })
    .catch((error) => {
      job.process = null
      job.snapshot = {
        ...emptyCaptionSnapshot('error'),
        error: error instanceof Error ? error.message : 'Caption extract failed',
        errorCode: 'network'
      }
    })
}

/** Authenticate and dispatch caption extract start, polling, and cancellation. */
export async function handleExtensionTranscript(
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
      reply(res, 400, { error: 'Invalid transcript input' })
      return
    }
    const language = input.language?.trim() || ''
    const id = createHash('sha256').update(`${origin}:${input.sourceUrl}:${language}`).digest('hex')
    const existing = jobs.get(id)
    const running = [...jobs.values()].filter((job) => job.snapshot.status === 'running')
    if (existing && input.refresh !== true) {
      reply(res, 200, { id, snapshot: existing.snapshot, token: existing.token })
      return
    }
    if (!existing && (jobs.size >= MAX_JOBS || running.length >= MAX_RUNNING)) {
      reply(res, 429, { error: 'Too many caption requests. Wait for a running extract to finish.' })
      return
    }
    if (existing) {
      stopJob(existing)
      jobs.delete(id)
    }
    const job: Job = {
      expiresAt: Date.now() + TTL_MS,
      language,
      origin,
      process: null,
      snapshot: emptyCaptionSnapshot(),
      sourceUrl: input.sourceUrl,
      token: randomBytes(32).toString('hex')
    }
    jobs.set(id, job)
    startExtract(job)
    reply(res, 200, { id, snapshot: job.snapshot, token: job.token })
    return
  }
  const parts = pathname.slice(PREFIX.length + 1).split('/')
  const job = jobs.get(parts[0] ?? '')
  if (!job || job.origin !== origin || job.token !== token) {
    reply(res, 401, { error: 'Transcript session expired' })
    return
  }
  if (parts.length === 1 && req.method === 'GET') {
    reply(res, 200, job.snapshot)
    return
  }
  if (parts.length === 2 && parts[1] === 'cancel' && req.method === 'POST') {
    stopJob(job)
    job.snapshot = {
      ...job.snapshot,
      status: 'error',
      error: 'Cancelled',
      errorCode: 'network',
      updatedAt: Date.now()
    }
    reply(res, 200, job.snapshot)
    return
  }
  reply(res, 405, { error: 'Method not allowed' })
}

/** Stop leftover extracts when the local server shuts down. */
export function clearExtensionTranscripts(): void {
  for (const job of jobs.values()) {
    stopJob(job)
  }
  jobs.clear()
}
