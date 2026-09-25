import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { expandSubtitleLanguageAliases } from '@vidbee/downloader-core/subtitle-languages'
import { isExtensionSourceUrl } from '../../shared/extension-source-url'
import type {
  ExtensionTranscriptInput,
  ExtensionTranscriptSnapshot,
  ExtensionTranscriptTrack
} from '../../shared/extension-transcript'
import {
  captionCuesFromPayload,
  classifyCaptionExtractError,
  parseCaptionSidecarName,
  pickExtensionCaptionTrack
} from '../../shared/extension-transcript'
import { settingsManager } from '../settings'
import { createBoundedTextBuffer } from './bounded-output-buffer'
import { buildCaptionExtractArgs } from './command-utils'
import { applyExtensionCookieSettings } from './extension-cookies'
import { applyExtensionCors, extensionRequestOrigin, replyExtensionJson } from './extension-origin'
import { ytdlpManager } from './ytdlp-manager'

const PREFIX = '/extension/v1/transcript'
const TTL_MS = 30 * 60 * 1000
const EXTRACT_TIMEOUT_MS = 90_000
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

/** Empty running snapshot used until yt-dlp finishes. */
function idleSnapshot(
  status: ExtensionTranscriptSnapshot['status'] = 'running'
): ExtensionTranscriptSnapshot {
  return {
    author: '',
    duration: 0,
    error: null,
    errorCode: null,
    segments: [],
    selectedTrackId: '',
    status,
    title: '',
    tracks: [],
    updatedAt: Date.now()
  }
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

/** Overlay live extension cookies onto Desktop's yt-dlp settings for this URL. */
async function settingsForUrl(url: string) {
  const settings = settingsManager.getAll()
  const overlay = await applyExtensionCookieSettings(url, {
    browserForCookies: settings.browserForCookies,
    cookiesPath: settings.cookiesPath
  })
  return overlay ? { ...settings, ...overlay } : settings
}

/** Run yt-dlp until it exits, times out, or is killed. */
function execCaptionExtract(
  args: string[],
  onProcess: (child: { kill: () => void }) => void
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = ytdlpManager.getInstance().exec(args)
    const stderr = createBoundedTextBuffer()
    proc.ytDlpProcess?.stderr?.on('data', (chunk: Buffer) => stderr.append(chunk))
    const child = {
      kill: () => {
        proc.ytDlpProcess?.kill('SIGTERM')
      }
    }
    onProcess(child)
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Caption extract timed out'))
    }, EXTRACT_TIMEOUT_MS)
    proc.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stderr: stderr.get() })
    })
  })
}

/** Read title, uploader, and duration from the yt-dlp info JSON sidecar. */
async function readInfoJson(
  directory: string
): Promise<{ author: string; duration: number; title: string }> {
  const names = await readdir(directory)
  const name = names.find((item) => item.endsWith('.info.json'))
  if (!name) {
    return { author: '', duration: 0, title: '' }
  }
  try {
    const payload = JSON.parse(await readFile(path.join(directory, name), 'utf8')) as {
      duration?: number
      title?: string
      uploader?: string
    }
    return {
      author: typeof payload.uploader === 'string' ? payload.uploader : '',
      duration: Number(payload.duration) || 0,
      title: typeof payload.title === 'string' ? payload.title : ''
    }
  } catch {
    return { author: '', duration: 0, title: '' }
  }
}

/** Load caption sidecars written next to the info JSON. */
async function readSidecarTracks(
  directory: string
): Promise<
  Array<
    ExtensionTranscriptTrack & { cues: Array<{ endMs: number; startMs: number; text: string }> }
  >
> {
  const names = await readdir(directory)
  const tracks: Array<
    ExtensionTranscriptTrack & { cues: Array<{ endMs: number; startMs: number; text: string }> }
  > = []
  for (const name of names) {
    const parsed = parseCaptionSidecarName(name)
    if (!parsed) {
      continue
    }
    const text = await readFile(path.join(directory, name), 'utf8')
    const cues = captionCuesFromPayload(text, parsed.format).filter(
      (cue) => Number.isFinite(cue.startMs) && cue.endMs > cue.startMs && cue.text.trim()
    )
    if (!cues.length) {
      continue
    }
    tracks.push({
      auto: parsed.auto,
      cues,
      id: parsed.language,
      label: parsed.language,
      language: parsed.language
    })
  }
  return tracks
}

/** Download caption sidecars for one watch URL and return a public snapshot. */
async function extractCaptions(
  sourceUrl: string,
  language: string,
  onProcess: (child: { kill: () => void }) => void
): Promise<ExtensionTranscriptSnapshot> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vidbee-ext-subs-'))
  try {
    const settings = await settingsForUrl(sourceUrl)
    const langs = language ? expandSubtitleLanguageAliases([language]).join(',') : 'all'
    const args = buildCaptionExtractArgs(sourceUrl, path.join(directory, '%(id)s'), settings, langs)
    const { code, stderr } = await execCaptionExtract(args, onProcess)
    if (code !== 0) {
      const errorCode = classifyCaptionExtractError(stderr)
      return {
        ...idleSnapshot('error'),
        error: stderr.trim().split('\n').at(-1) || 'Caption extract failed',
        errorCode
      }
    }
    const info = await readInfoJson(directory)
    const tracks = await readSidecarTracks(directory)
    const selected = pickExtensionCaptionTrack(tracks, language)
    if (!selected) {
      return {
        ...idleSnapshot('error'),
        ...info,
        error: 'No captions available',
        errorCode: 'noCaptions'
      }
    }
    return {
      author: info.author,
      duration: info.duration,
      error: null,
      errorCode: null,
      segments: selected.cues.map((cue) => ({
        end: cue.endMs / 1000,
        start: cue.startMs / 1000,
        text: cue.text
      })),
      selectedTrackId: selected.id,
      status: 'completed',
      title: info.title,
      tracks: tracks.map(({ auto, id, label, language: itemLanguage }) => ({
        auto,
        id,
        label,
        language: itemLanguage
      })),
      updatedAt: Date.now()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Caption extract failed'
    return {
      ...idleSnapshot('error'),
      error: message,
      errorCode: classifyCaptionExtractError(message)
    }
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

/** Start yt-dlp in the background and publish the snapshot when it finishes. */
function startExtract(job: Job): void {
  void extractCaptions(job.sourceUrl, job.language, (child) => {
    job.process = child
  })
    .then((snapshot) => {
      job.process = null
      job.snapshot = snapshot
    })
    .catch((error) => {
      job.process = null
      job.snapshot = {
        ...idleSnapshot('error'),
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
      snapshot: idleSnapshot(),
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
