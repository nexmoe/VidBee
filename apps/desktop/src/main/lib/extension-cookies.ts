import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { DownloadRuntimeSettings } from '@vidbee/downloader-core'
import {
  type CookieHealth,
  cookieDomainsForUrl,
  cookieMatchesUrlScope,
  looksLikeNetscapeCookies,
  matchCookieSites,
  type NetscapeCookieInput,
  serializeNetscapeCookies
} from '@vidbee/downloader-core/cookie-setup'
import type { ExtensionCookieConnection } from '../../shared/extension-cookies'
import { settingsManager } from '../settings'
import { scopedLoggers } from '../utils/logger'
import { applyExtensionCors, extensionRequestOrigin, replyExtensionJson } from './extension-origin'

const PREFIX = '/extension/v1'
const CONNECT_PATH = `${PREFIX}/connect`
const WAIT_PATH = `${PREFIX}/wait`
const COOKIES_PATH = `${PREFIX}/cookies`
const SESSION_TTL_MS = 45_000
const WAIT_TIMEOUT_MS = 25_000
const COOKIE_REQUEST_TIMEOUT_MS = 12_000
const MAX_SESSIONS = 32
const MAX_SOURCES = 64
const MAX_COOKIE_ROWS = 4000
const COOKIE_FILE_TTL_MS = 60 * 60 * 1000
const BROWSER_IDS = new Set([
  'chrome',
  'chromium',
  'firefox',
  'edge',
  'safari',
  'brave',
  'opera',
  'vivaldi',
  'whale'
])

interface Session {
  browser: string
  sourceId: string
  lastSeenAt: number
  origin: string
  sites: ExtensionCookieConnection['sites']
  token: string
}

interface CookieJob {
  domains: string[]
  id: string
  sessionToken: string
  url: string
}

interface Waiter {
  resolve: (event: WaitEvent) => void
  sessionToken: string
}

type WaitEvent =
  | { type: 'idle'; sites: ExtensionCookieConnection['sites'] }
  | { type: 'cookies'; id: string; url: string; domains: string[] }

const logger = scopedLoggers.system
const sessions = new Map<string, Session>()
const jobs = new Map<string, CookieJob>()
const jobWaiters = new Map<
  string,
  { resolve: (cookies: NetscapeCookieInput[] | null) => void; timer: NodeJS.Timeout }
>()
const waiters: Waiter[] = []

/** Recognize the extension cookie-bridge namespace before the GET-only dispatcher. */
export function isExtensionCookiesPath(pathname: string): boolean {
  return pathname === CONNECT_PATH || pathname === WAIT_PATH || pathname === COOKIES_PATH
}

/** Snapshot used by Settings and `/status` without exposing session tokens. */
export function getExtensionCookieConnection(): ExtensionCookieConnection {
  pruneSessions()
  const live = new Map([...sessions.values()].map((session) => [session.sourceId, session]))
  const sources = sourcePreferences().map((source) => {
    const session = live.get(source.id)
    return {
      ...source,
      connected: !!session,
      lastSeenAt: session?.lastSeenAt,
      sites: session?.sites ?? []
    }
  })
  const active = sources.find((source) => source.connected)
  return {
    activeSourceId: active?.id,
    browser: active?.browser,
    connected: !!active,
    lastSeenAt: active?.lastSeenAt,
    sites: active?.sites ?? [],
    sources
  }
}

/** Persist a user-selected priority, retaining profiles discovered during a concurrent edit. */
export function setExtensionCookieSourceOrder(sourceIds: string[]): ExtensionCookieConnection {
  const sources = sourcePreferences()
  if (
    !Array.isArray(sourceIds) ||
    sourceIds.length > MAX_SOURCES ||
    new Set(sourceIds).size !== sourceIds.length ||
    sourceIds.some((id) => !sources.some((source) => source.id === id))
  ) {
    throw new Error('Invalid extension cookie source order')
  }
  const byId = new Map(sources.map((source) => [source.id, source]))
  const ordered = sourceIds.flatMap((id) => {
    const source = byId.get(id)
    return source ? [source] : []
  })
  settingsManager.set('extensionCookieSources', [
    ...ordered,
    ...sources.filter((source) => !sourceIds.includes(source.id))
  ])
  return getExtensionCookieConnection()
}

/**
 * Ask the connected extension for cookies for this URL and, when they arrive,
 * return runtime settings that point yt-dlp at a temporary Netscape file.
 *
 * @param url Download or metadata URL.
 * @param settings Existing runtime settings to overlay.
 */
export async function applyExtensionCookieSettings(
  url: string,
  settings?: DownloadRuntimeSettings
): Promise<DownloadRuntimeSettings | undefined> {
  pruneSessions()
  for (const session of orderedSessions()) {
    if (!sessions.has(session.token)) {
      continue
    }
    const cookies = await requestCookiesForUrl(url, session)
    if (!cookies?.length) {
      continue
    }
    const netscape = serializeNetscapeCookies(cookies)
    if (!looksLikeNetscapeCookies(netscape)) {
      continue
    }
    const cookiesPath = await writeCookiesFile(netscape)
    logger.info(
      `extension-cookies: wrote ${cookies.length} cookies from ${session.browser} for download`
    )
    return {
      ...settings,
      browserForCookies: 'none',
      cookiesPath,
      cookieSource: { type: 'extension', browser: session.browser }
    }
  }
  return undefined
}

/** Drop sessions and pending jobs when the local API stops. */
export function clearExtensionCookies(): void {
  sessions.clear()
  jobs.clear()
  for (const waiter of waiters.splice(0)) {
    waiter.resolve({ sites: [], type: 'idle' })
  }
  for (const [id, waiter] of jobWaiters) {
    clearTimeout(waiter.timer)
    waiter.resolve(null)
    jobWaiters.delete(id)
  }
}

/**
 * Authenticate and dispatch connect, wait, and cookie-fulfill requests.
 *
 * @param req Incoming request.
 * @param res HTTP response.
 * @param pathname Request path.
 * @param consumeToken One-use start token from `/token`.
 */
export async function handleExtensionCookies(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  consumeToken: (token: string, origin: string) => boolean
): Promise<void> {
  const origin = extensionRequestOrigin(req)
  if (!origin) {
    replyExtensionJson(res, 403, { error: 'Extension origin required' })
    return
  }
  applyExtensionCors(res, origin)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  pruneSessions()
  const bearer = readBearer(req)

  if (pathname === CONNECT_PATH && req.method === 'POST') {
    if (!consumeToken(bearer, origin)) {
      replyExtensionJson(res, 401, { error: 'Invalid start token' })
      return
    }
    const body = await readConnectBody(req)
    if (!body) {
      replyExtensionJson(res, 400, { error: 'Invalid connect payload' })
      return
    }
    const sourceId = createHash('sha256')
      .update(`${origin}\0${body.clientId ?? body.browser}`)
      .digest('hex')
    const previous = [...sessions.values()].find((candidate) => candidate.sourceId === sourceId)
    if (!previous && sessions.size >= MAX_SESSIONS) {
      replyExtensionJson(res, 429, { error: 'Too many extension sessions' })
      return
    }
    const sources = sourcePreferences()
    if (!sources.some((source) => source.id === sourceId)) {
      if (sources.length >= MAX_SOURCES) {
        const inactive = sources.findLastIndex(
          (source) => ![...sessions.values()].some((candidate) => candidate.sourceId === source.id)
        )
        if (inactive >= 0) {
          sources.splice(inactive, 1)
        }
      }
      settingsManager.set('extensionCookieSources', [
        ...sources,
        { id: sourceId, browser: body.browser }
      ])
    }
    if (previous) {
      dropSession(previous.token)
    }
    const token = randomBytes(32).toString('hex')
    const session: Session = {
      browser: body.browser,
      sourceId,
      lastSeenAt: Date.now(),
      origin,
      sites: body.sites,
      token
    }
    sessions.set(token, session)
    logger.info(`extension-cookies: ${origin} connected as ${body.browser}`)
    replyExtensionJson(res, 200, { session: token, expiresInMs: SESSION_TTL_MS })
    return
  }

  const session = bearer ? sessions.get(bearer) : undefined
  if (!session || session.origin !== origin) {
    replyExtensionJson(res, 401, { error: 'Extension session expired' })
    return
  }
  session.lastSeenAt = Date.now()

  if (pathname === WAIT_PATH && req.method === 'GET') {
    const queued = [...jobs.values()].find((job) => job.sessionToken === session.token)
    if (queued) {
      replyExtensionJson(res, 200, {
        domains: queued.domains,
        id: queued.id,
        type: 'cookies',
        url: queued.url
      })
      return
    }
    const event = await waitForEvent(session.token, req)
    if (res.writableEnded || req.destroyed) {
      return
    }
    replyExtensionJson(res, 200, event)
    return
  }

  if (pathname === COOKIES_PATH && req.method === 'POST') {
    const payload = await readCookiesBody(req)
    if (!payload) {
      replyExtensionJson(res, 400, { error: 'Invalid cookies payload' })
      return
    }
    const job = jobs.get(payload.id)
    if (!job || job.sessionToken !== session.token) {
      replyExtensionJson(res, 404, { error: 'Unknown cookie request' })
      return
    }
    if (payload.cookies.some((cookie) => !cookieMatchesUrlScope(cookie.domain, job.url))) {
      replyExtensionJson(res, 400, { error: 'Cookie domain outside requested scope' })
      return
    }
    session.sites = matchCookieSites(
      payload.cookies.map((cookie) => ({
        domain: cookie.domain,
        expires: cookie.session || !cookie.expirationDate ? 0 : Math.floor(cookie.expirationDate),
        name: cookie.name
      }))
    )
    fulfillJob(payload.id, payload.cookies)
    replyExtensionJson(res, 200, { ok: true })
    return
  }

  replyExtensionJson(res, 405, { error: 'Method not allowed' })
}

/**
 * Ask the selected extension for cookies covering this URL.
 *
 * @param url Download URL.
 * @param session Browser installation selected before the asynchronous request.
 */
async function requestCookiesForUrl(
  url: string,
  session: Session
): Promise<NetscapeCookieInput[] | null> {
  const domains = cookieDomainsForUrl(url)
  if (domains.length === 0) {
    return null
  }
  const id = randomBytes(16).toString('hex')
  jobs.set(id, { domains, id, sessionToken: session.token, url })
  flushWaiters(session.token, { domains, id, type: 'cookies', url })
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      logger.info('extension-cookies: cookie request timed out')
      dropSession(session.token)
    }, COOKIE_REQUEST_TIMEOUT_MS)
    jobWaiters.set(id, {
      resolve: (cookies) => {
        clearTimeout(timer)
        resolve(cookies)
      },
      timer
    })
  })
}

/** Health snapshot for the cookies settings page when the extension is connected. */
export function extensionCookieHealth(): CookieHealth | null {
  const connection = getExtensionCookieConnection()
  if (!connection.connected) {
    return null
  }
  const fresh = connection.sites.filter((site) => !site.expired)
  if (fresh.length > 0) {
    return { browser: connection.browser, source: 'extension', status: 'ok', sites: fresh }
  }
  return {
    browser: connection.browser,
    reason: 'no-session',
    source: 'extension',
    status: 'empty',
    sites: connection.sites
  }
}

/**
 * Write a Netscape cookies.txt that yt-dlp can read, then delete it later.
 *
 * @param netscape File body.
 */
async function writeCookiesFile(netscape: string): Promise<string> {
  const filePath = path.join(
    os.tmpdir(),
    `vidbee-ext-cookies-${randomBytes(8).toString('hex')}.txt`
  )
  await fs.writeFile(filePath, netscape, { encoding: 'utf8', mode: 0o600 })
  setTimeout(() => {
    void fs.unlink(filePath).catch(() => undefined)
  }, COOKIE_FILE_TTL_MS)
  return filePath
}

/** Read a copy so reordering never mutates electron-store's cached settings value. */
function sourcePreferences() {
  return [...(settingsManager.get('extensionCookieSources') ?? [])]
}

/** Resolve live sessions in saved priority order, skipping every offline profile. */
function orderedSessions(): Session[] {
  const live = new Map([...sessions.values()].map((session) => [session.sourceId, session]))
  return sourcePreferences().flatMap((source) => {
    const session = live.get(source.id)
    return session ? [session] : []
  })
}

/** Drop sessions whose wait loop has gone quiet. */
function pruneSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS
  for (const [token, session] of sessions) {
    if (session.lastSeenAt >= cutoff) {
      continue
    }
    dropSession(token)
  }
}

/** Revoke one installation's session and release only its pending requests. */
function dropSession(token: string): void {
  sessions.delete(token)
  flushWaiters(token, { sites: [], type: 'idle' })
  for (const [id, job] of jobs) {
    if (job.sessionToken === token) {
      fulfillJob(id, null)
    }
  }
}

/** Complete a pending cookie request and drop it from the queue. */
function fulfillJob(id: string, cookies: NetscapeCookieInput[] | null): void {
  jobs.delete(id)
  const waiter = jobWaiters.get(id)
  if (!waiter) {
    return
  }
  jobWaiters.delete(id)
  clearTimeout(waiter.timer)
  waiter.resolve(cookies)
}

/** Push an event to every waiter for this session. */
function flushWaiters(sessionToken: string, event: WaitEvent): void {
  for (let index = waiters.length - 1; index >= 0; index -= 1) {
    const waiter = waiters[index]
    if (waiter?.sessionToken !== sessionToken) {
      continue
    }
    waiters.splice(index, 1)
    waiter.resolve(event)
  }
}

/**
 * Hold a long-poll until a cookie request arrives or the idle timeout fires.
 *
 * @param sessionToken Live session token.
 * @param req Incoming wait request, aborted when the extension disconnects.
 */
function waitForEvent(sessionToken: string, req: IncomingMessage): Promise<WaitEvent> {
  return new Promise((resolve) => {
    const session = sessions.get(sessionToken)
    let settled = false
    /** Settle once and release the timeout and request listener. */
    const finish = (event: WaitEvent): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      req.off('close', onClose)
      const index = waiters.indexOf(waiter)
      if (index >= 0) {
        waiters.splice(index, 1)
      }
      resolve(event)
    }
    const waiter: Waiter = { resolve: finish, sessionToken }
    /** Mark a disconnected browser offline and release its outstanding cookie requests. */
    const onClose = (): void => {
      dropSession(sessionToken)
      finish({ sites: session?.sites ?? [], type: 'idle' })
    }
    const timer = setTimeout(
      () => finish({ sites: session?.sites ?? [], type: 'idle' }),
      WAIT_TIMEOUT_MS
    )
    waiters.push(waiter)
    req.on('close', onClose)
  })
}

/** Read a Bearer token from the Authorization header. */
function readBearer(req: IncomingMessage): string {
  return req.headers.authorization?.replace(/^Bearer /i, '').trim() ?? ''
}

/**
 * Parse and bound the extension connect payload.
 *
 * @param req Incoming POST body.
 */
async function readConnectBody(req: IncomingMessage): Promise<{
  browser: string
  clientId?: string
  sites: ExtensionCookieConnection['sites']
} | null> {
  const body = await readJson(req, 16_384)
  if (!body || typeof body !== 'object') {
    return null
  }
  const payload = body as { browser?: unknown; clientId?: unknown; sites?: unknown }
  if (typeof payload.browser !== 'string' || !BROWSER_IDS.has(payload.browser)) {
    return null
  }
  if (
    payload.clientId !== undefined &&
    (typeof payload.clientId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.clientId))
  ) {
    return null
  }
  return { browser: payload.browser, clientId: payload.clientId, sites: parseSites(payload.sites) }
}

/**
 * Parse cookie rows posted for a pending download request.
 *
 * @param req Incoming POST body.
 */
async function readCookiesBody(
  req: IncomingMessage
): Promise<{ id: string; cookies: NetscapeCookieInput[] } | null> {
  const body = await readJson(req, 2_000_000)
  if (!body || typeof body !== 'object') {
    return null
  }
  const payload = body as { id?: unknown; cookies?: unknown }
  if (typeof payload.id !== 'string' || !/^[a-f0-9]{32}$/i.test(payload.id)) {
    return null
  }
  if (!Array.isArray(payload.cookies) || payload.cookies.length > MAX_COOKIE_ROWS) {
    return null
  }
  const cookies: NetscapeCookieInput[] = []
  for (const row of payload.cookies) {
    const cookie = parseCookieRow(row)
    if (cookie) {
      cookies.push(cookie)
    }
  }
  return { cookies, id: payload.id }
}

/** Accept only bounded site summaries from the extension. */
function parseSites(value: unknown): ExtensionCookieConnection['sites'] {
  if (!Array.isArray(value) || value.length > 32) {
    return []
  }
  const sites: ExtensionCookieConnection['sites'] = []
  for (const row of value) {
    if (!row || typeof row !== 'object') {
      continue
    }
    const site = row as { id?: unknown; label?: unknown; expired?: unknown }
    if (typeof site.id !== 'string' || site.id.length > 32) {
      continue
    }
    if (typeof site.label !== 'string' || site.label.length > 64) {
      continue
    }
    sites.push({ expired: site.expired === true, id: site.id, label: site.label })
  }
  return sites
}

/** Accept a single cookie row, dropping oversized or malformed fields. */
function parseCookieRow(value: unknown): NetscapeCookieInput | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const row = value as Record<string, unknown>
  if (typeof row.domain !== 'string' || row.domain.length > 253) {
    return null
  }
  if (typeof row.name !== 'string' || row.name.length > 256) {
    return null
  }
  if (typeof row.value !== 'string' || row.value.length > 8192) {
    return null
  }
  const cookie: NetscapeCookieInput = { domain: row.domain, name: row.name, value: row.value }
  if (typeof row.path === 'string' && row.path.length <= 512) {
    cookie.path = row.path
  }
  if (typeof row.secure === 'boolean') {
    cookie.secure = row.secure
  }
  if (typeof row.httpOnly === 'boolean') {
    cookie.httpOnly = row.httpOnly
  }
  if (typeof row.hostOnly === 'boolean') {
    cookie.hostOnly = row.hostOnly
  }
  if (typeof row.session === 'boolean') {
    cookie.session = row.session
  }
  if (typeof row.expirationDate === 'number' && Number.isFinite(row.expirationDate)) {
    cookie.expirationDate = row.expirationDate
  }
  return cookie
}

/**
 * Read a JSON body with a hard size cap.
 *
 * @param req Incoming request.
 * @param maxBytes Maximum accepted payload.
 */
async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > maxBytes) {
      return null
    }
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    return null
  }
}
