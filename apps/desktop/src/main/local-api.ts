import crypto from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Task, TaskQueueEvent } from '@vidbee/task-queue'

import { projectTaskToLegacy } from '@vidbee/task-queue'
import log from 'electron-log/main'
import {
  getAutomationDescriptorPath,
  initAutomationDescriptor,
  removeAutomationDescriptor,
  updateAutomationDescriptorToken
} from './lib/automation-descriptor'
import { downloadEngine } from './lib/download-facade'
import {
  clearExtensionCookies,
  getExtensionCookieConnection,
  handleExtensionCookies,
  isExtensionCookiesPath
} from './lib/extension-cookies'
import { applyExtensionCors } from './lib/extension-origin'
import {
  clearExtensionOverviews,
  handleExtensionOverview,
  isExtensionOverviewPath
} from './lib/extension-overview'
import {
  classifyLocalApiCaller,
  LOCAL_API_PORT_END,
  LOCAL_API_PORT_START
} from './lib/local-api-guard'
import { getDesktopSubscriptions, removeDesktopSubscription } from './lib/subscriptions-host'
import {
  getDesktopTaskQueue,
  isDesktopTaskQueuePersistent,
  startDesktopTaskQueue,
  stopDesktopTaskQueue
} from './lib/task-queue-host'

const PORT_RANGE_START = LOCAL_API_PORT_START
const PORT_RANGE_END = LOCAL_API_PORT_END

const EXTENSION_TOKEN_TTL_MS = 60_000
const AUTOMATION_TOKEN_TTL_MS = 60 * 60 * 1000

const AUTOMATION_PREFIX = '/automation/v1'
const AUTOMATION_SCHEMA_VERSION = '1.0.0'

interface ExtensionTokenRecord {
  expiresAt: number
}

interface AutomationTokenRecord {
  expiresAt: number
}

let server: http.Server | null = null
const serverHost = '127.0.0.1'
let serverPort: number | null = null

const extensionTokens = new Map<string, ExtensionTokenRecord>()

let automationToken: string | null = null
let automationTokenRecord: AutomationTokenRecord | null = null

const isLoopbackAddress = (address?: string | null): boolean => {
  if (!address) {
    return false
  }
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

const writeJson = (res: http.ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8'
  })
  res.end(JSON.stringify(body))
}

const writeEmpty = (res: http.ServerResponse, status: number): void => {
  res.writeHead(status)
  res.end()
}

// ───────────── Extension token ─────────────

const issueExtensionToken = (): string => {
  const token = crypto.randomBytes(16).toString('hex')
  extensionTokens.set(token, { expiresAt: Date.now() + EXTENSION_TOKEN_TTL_MS })
  return token
}

const consumeExtensionToken = (token?: string | null): boolean => {
  if (!token) {
    return false
  }
  const record = extensionTokens.get(token)
  if (!record) {
    return false
  }
  if (Date.now() > record.expiresAt) {
    extensionTokens.delete(token)
    return false
  }
  extensionTokens.delete(token)
  return true
}

// ───────────── Automation token ─────────────

const rotateAutomationToken = (): { token: string; expiresAt: number } => {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = Date.now() + AUTOMATION_TOKEN_TTL_MS
  automationToken = token
  automationTokenRecord = { expiresAt }
  if (serverPort) {
    updateAutomationDescriptorToken({
      host: serverHost,
      port: serverPort,
      token,
      ttlMs: AUTOMATION_TOKEN_TTL_MS
    })
  }
  return { token, expiresAt }
}

const validateAutomationBearer = (req: http.IncomingMessage): boolean => {
  if (!(automationToken && automationTokenRecord)) {
    return false
  }
  if (Date.now() > automationTokenRecord.expiresAt) {
    return false
  }
  const auth = req.headers.authorization?.trim()
  if (!auth?.toLowerCase().startsWith('bearer ')) {
    return false
  }
  return auth.slice('bearer '.length).trim() === automationToken
}

// ───────────── JSON body reader ─────────────

const readJsonBody = (req: http.IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let total = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      total += chunk.byteLength
      if (total > maxBytes) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        return resolve({})
      }
      try {
        const text = Buffer.concat(chunks).toString('utf-8')
        resolve(text.length === 0 ? {} : JSON.parse(text))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })

// ───────────── Automation /events SSE ─────────────

const automationSseClients = new Set<http.ServerResponse>()
let unsubscribeFromTaskQueue: (() => void) | null = null
let heartbeatTimer: NodeJS.Timeout | null = null

const SSE_HEARTBEAT_MS = 15_000

const sseSubscribeIfNeeded = (): void => {
  if (unsubscribeFromTaskQueue) {
    return
  }
  const queue = getDesktopTaskQueue()
  unsubscribeFromTaskQueue = queue.subscribe((event: TaskQueueEvent) => {
    if (automationSseClients.size === 0) {
      return
    }
    const data = JSON.stringify(serializeEventForWire(event))
    const message = `event: ${event.type}\ndata: ${data}\n\n`
    for (const client of automationSseClients) {
      client.write(message)
    }
  })
}

const startSseHeartbeat = (): void => {
  if (heartbeatTimer) {
    return
  }
  heartbeatTimer = setInterval(() => {
    if (automationSseClients.size === 0) {
      return
    }
    for (const client of automationSseClients) {
      client.write(': heartbeat\n\n')
    }
  }, SSE_HEARTBEAT_MS)
}

const stopSseHeartbeat = (): void => {
  if (!heartbeatTimer) {
    return
  }
  clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

const serializeEventForWire = (event: TaskQueueEvent): unknown => {
  if (
    (event.type === 'snapshot-changed' || event.type === 'progress') &&
    event.type === 'snapshot-changed'
  ) {
    return { ...event, projection: projectTaskToLegacy(event.task) }
  }
  return event
}

// ───────────── Automation request dispatch ─────────────

const handleAutomationRequest = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string
): Promise<void> => {
  if (pathname === `${AUTOMATION_PREFIX}/health`) {
    if (req.method !== 'GET') {
      return writeJson(res, 405, { error: 'Method not allowed' })
    }
    return writeJson(res, 200, {
      ok: true,
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      persistent: isDesktopTaskQueuePersistent()
    })
  }

  if (pathname === `${AUTOMATION_PREFIX}/handshake`) {
    if (req.method !== 'POST') {
      return writeJson(res, 405, { error: 'Method not allowed' })
    }
    // PID identity verification (per design §5.3) is best-effort here; the
    // request is already loopback-only via the outer guard.
    try {
      await readJsonBody(req)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid request body'
      return writeJson(res, 400, { error: message })
    }
    const { token, expiresAt } = rotateAutomationToken()
    return writeJson(res, 200, {
      token,
      expiresAt,
      ttlMs: AUTOMATION_TOKEN_TTL_MS,
      schemaVersion: AUTOMATION_SCHEMA_VERSION
    })
  }

  if (pathname === `${AUTOMATION_PREFIX}/events`) {
    if (req.method !== 'GET') {
      return writeJson(res, 405, { error: 'Method not allowed' })
    }
    if (!validateAutomationBearer(req)) {
      return writeJson(res, 401, { error: 'Unauthorized' })
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    res.write('event: connected\ndata: {"ok":true}\n\n')
    automationSseClients.add(res)
    sseSubscribeIfNeeded()
    startSseHeartbeat()
    req.on('close', () => {
      automationSseClients.delete(res)
      if (automationSseClients.size === 0) {
        stopSseHeartbeat()
      }
    })
    return
  }

  // taskQueueContract methods (POST /automation/v1/{add|get|list|cancel|...}).
  if (req.method === 'GET' && pathname === `${AUTOMATION_PREFIX}/stats`) {
    if (!validateAutomationBearer(req)) {
      return writeJson(res, 401, { error: 'Unauthorized' })
    }
    return writeJson(res, 200, getDesktopTaskQueue().stats())
  }

  if (req.method !== 'POST') {
    return writeJson(res, 404, { error: 'Not found' })
  }
  if (!validateAutomationBearer(req)) {
    return writeJson(res, 401, { error: 'Unauthorized' })
  }

  // subscriptionContract methods are nested under /automation/v1/subscriptions/<op>
  // (NEX-132 Phase B). The CLI forwards `vidbee :rss <verb>` calls here.
  const SUBSCRIPTIONS_PREFIX = `${AUTOMATION_PREFIX}/subscriptions/`
  if (pathname.startsWith(SUBSCRIPTIONS_PREFIX)) {
    return handleAutomationSubscriptions(pathname.slice(SUBSCRIPTIONS_PREFIX.length), req, res)
  }

  const op = pathname.slice(`${AUTOMATION_PREFIX}/`.length)
  let body: Record<string, unknown>
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>
  } catch (err) {
    return writeJson(res, 400, {
      error: err instanceof Error ? err.message : 'Invalid request body'
    })
  }

  const queue = getDesktopTaskQueue()
  try {
    switch (op) {
      case 'add': {
        const result = await queue.add({
          input: body.input as never,
          priority: body.priority as never,
          groupKey: body.groupKey as never,
          parentId: body.parentId as never,
          maxAttempts: body.maxAttempts as never
        })
        return writeJson(res, 200, result)
      }
      case 'get': {
        const task = queue.get(body.id as string)
        return writeJson(res, 200, taskOrProjection(task))
      }
      case 'list': {
        const page = queue.list({
          status: body.status as never,
          groupKey: body.groupKey as never,
          parentId: body.parentId as never,
          limit: body.limit as never,
          cursor: (body.cursor as string | undefined) ?? null
        })
        return writeJson(res, 200, {
          tasks: page.tasks.map(taskOrProjection),
          nextCursor: page.nextCursor
        })
      }
      case 'cancel':
        await queue.cancel(body.id as string)
        return writeJson(res, 200, { ok: true })
      case 'pause':
        await queue.pause(body.id as string, body.reason as string | undefined)
        return writeJson(res, 200, { ok: true })
      case 'resume':
        await queue.resume(body.id as string)
        return writeJson(res, 200, { ok: true })
      case 'retry':
        await queue.retryManual(body.id as string)
        return writeJson(res, 200, { ok: true })
      case 'setMaxConcurrency':
        await queue.setMaxConcurrency(body.n as number)
        return writeJson(res, 200, { ok: true })
      case 'setMaxPerGroup':
        await queue.setMaxPerGroup(body.groupKey as string, (body.n as number | null) ?? null)
        return writeJson(res, 200, { ok: true })
      case 'removeFromHistory':
        await queue.removeFromHistory(body.id as string)
        return writeJson(res, 200, { ok: true })
      default:
        return writeJson(res, 404, { error: `Unknown automation op: ${op}` })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Automation handler failed'
    return writeJson(res, 500, { error: message })
  }
}

const taskOrProjection = (task: Readonly<Task> | undefined): unknown => {
  if (!task) {
    return null
  }
  return { task, projection: projectTaskToLegacy(task) }
}

const handleAutomationSubscriptions = async (
  op: string,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> => {
  let body: Record<string, unknown> = {}
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>
  } catch (err) {
    return writeJson(res, 400, {
      error: err instanceof Error ? err.message : 'Invalid request body'
    })
  }
  const api = getDesktopSubscriptions()
  try {
    switch (op) {
      case 'list':
        return writeJson(res, 200, await api.list())
      case 'get':
        return writeJson(res, 200, await api.get({ id: String(body.id ?? '') }))
      case 'resolve':
        return writeJson(res, 200, api.resolve({ rawUrl: String(body.rawUrl ?? '') }))
      case 'add':
        return writeJson(res, 200, await api.add(body as never))
      case 'update':
        return writeJson(res, 200, await api.update(body as never))
      case 'remove':
        await removeDesktopSubscription(String(body.id ?? ''))
        return writeJson(res, 200, {})
      case 'refresh':
        return writeJson(res, 200, await api.refresh({ id: String(body.id ?? '') }))
      case 'itemsList':
        return writeJson(
          res,
          200,
          await api.itemsList(body as { subscriptionId: string; limit?: number; offset?: number })
        )
      case 'itemsQueue':
        return writeJson(
          res,
          200,
          await api.itemsQueue({
            subscriptionId: String(body.subscriptionId ?? ''),
            itemId: String(body.itemId ?? '')
          })
        )
      default:
        return writeJson(res, 404, { error: `Unknown subscriptions op: ${op}` })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Subscriptions handler failed'
    return writeJson(res, 500, { error: message })
  }
}

// ───────────── Top-level request handler ─────────────

const handleRequest = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> => {
  try {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      writeJson(res, 403, { error: 'Forbidden' })
      return
    }

    const caller = classifyLocalApiCaller(req.headers)
    if (caller.kind === 'rejected') {
      writeJson(res, 403, {
        error: caller.reason === 'host' ? 'Forbidden host' : 'Forbidden origin'
      })
      return
    }
    if (caller.kind === 'extension') {
      applyExtensionCors(res, caller.origin)
    }

    if (req.url && isExtensionOverviewPath(new URL(req.url, 'http://127.0.0.1').pathname)) {
      await handleExtensionOverview(
        req,
        res,
        new URL(req.url, 'http://127.0.0.1').pathname,
        consumeExtensionToken
      )
      return
    }

    if (req.url && isExtensionCookiesPath(new URL(req.url, 'http://127.0.0.1').pathname)) {
      await handleExtensionCookies(
        req,
        res,
        new URL(req.url, 'http://127.0.0.1').pathname,
        consumeExtensionToken
      )
      return
    }

    if (req.method === 'OPTIONS') {
      writeEmpty(res, 204)
      return
    }

    if (!req.url) {
      writeJson(res, 400, { error: 'Missing URL' })
      return
    }

    const requestUrl = new URL(req.url, 'http://127.0.0.1')
    const pathname = requestUrl.pathname

    if (pathname.startsWith(`${AUTOMATION_PREFIX}/`) || pathname === AUTOMATION_PREFIX) {
      if (caller.kind !== 'cli') {
        writeJson(res, 403, { error: 'Forbidden origin' })
        return
      }
      await handleAutomationRequest(req, res, pathname)
      return
    }

    if (req.method !== 'GET') {
      writeJson(res, 405, { error: 'Method not allowed' })
      return
    }

    if (pathname === '/token') {
      if (caller.kind !== 'extension') {
        writeJson(res, 403, { error: 'Extension origin required' })
        return
      }
      const token = issueExtensionToken()
      writeJson(res, 200, { token, expiresInMs: EXTENSION_TOKEN_TTL_MS })
      return
    }

    if (pathname === '/video-info') {
      if (caller.kind !== 'extension') {
        writeJson(res, 403, { error: 'Extension origin required' })
        return
      }
      const token = requestUrl.searchParams.get('token')
      if (!consumeExtensionToken(token)) {
        writeJson(res, 401, { error: 'Invalid token' })
        return
      }

      const targetUrl = requestUrl.searchParams.get('url')
      if (!targetUrl?.trim()) {
        writeJson(res, 400, { error: 'Missing url' })
        return
      }

      try {
        const info = await downloadEngine.getVideoInfo(targetUrl.trim())
        writeJson(res, 200, {
          title: info.title,
          thumbnail: info.thumbnail,
          duration: info.duration,
          formats: info.formats ?? []
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch video info'
        const details =
          error instanceof Error
            ? error.stack
            : typeof error === 'object' && error && 'stderr' in error
              ? String((error as { stderr?: unknown }).stderr ?? '')
              : undefined
        writeJson(res, 500, { error: message, details })
      }
      return
    }

    if (pathname === '/status') {
      writeJson(res, 200, {
        ok: true,
        capabilities: { extensionCookies: 1, extensionOverview: 1 },
        extension: getExtensionCookieConnection()
      })
      return
    }

    writeJson(res, 404, { error: 'Not found' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unhandled request error'
    writeJson(res, 500, { error: message })
  }
}

const startServerOnPort = (port: number): Promise<http.Server> =>
  new Promise((resolve, reject) => {
    const httpServer = http.createServer((req, res) => {
      void handleRequest(req, res)
    })

    httpServer.once('error', (error) => {
      httpServer.close()
      reject(error)
    })

    httpServer.listen(port, '127.0.0.1', () => resolve(httpServer))
  })

export async function startExtensionApiServer(): Promise<number | null> {
  if (server && serverPort) {
    return serverPort
  }

  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port += 1) {
    try {
      server = await startServerOnPort(port)
      const address = server.address() as AddressInfo | null
      serverPort = address?.port ?? port
      log.info(`Extension API listening on 127.0.0.1:${serverPort}`)

      // Boot the desktop TaskQueue + write descriptor so CLI can see us.
      try {
        await startDesktopTaskQueue()
      } catch (err) {
        log.warn('startExtensionApiServer: TaskQueue failed to start:', err)
      }
      try {
        initAutomationDescriptor({ host: serverHost, port: serverPort })
        log.info(`Automation descriptor written at ${getAutomationDescriptorPath()}`)
      } catch (err) {
        log.warn('startExtensionApiServer: failed to write descriptor:', err)
      }
      return serverPort
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code !== 'EADDRINUSE') {
        log.warn('Extension API failed to start on port:', port, err)
      }
    }
  }

  log.error(`Extension API failed to bind any port in range ${PORT_RANGE_START}-${PORT_RANGE_END}`)
  return null
}

export async function stopExtensionApiServer(): Promise<void> {
  if (!server) {
    return
  }

  if (unsubscribeFromTaskQueue) {
    try {
      unsubscribeFromTaskQueue()
    } catch {
      /* noop */
    }
    unsubscribeFromTaskQueue = null
  }
  stopSseHeartbeat()
  for (const client of automationSseClients) {
    try {
      client.end()
    } catch {
      /* noop */
    }
  }
  automationSseClients.clear()

  await new Promise<void>((resolve) => {
    server?.close(() => resolve())
  })

  server = null
  serverPort = null
  clearExtensionOverviews()
  clearExtensionCookies()
  extensionTokens.clear()
  automationToken = null
  automationTokenRecord = null
  removeAutomationDescriptor()
  await stopDesktopTaskQueue().catch(() => {
    /* noop */
  })
}
