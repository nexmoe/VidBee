import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import log from 'electron-log/main'
import { authorizeMcp, isMcpAvailable, publishMcpEndpoint, unpublishMcpEndpoint } from './config'
import { createDesktopMcpServer, desktopMcpTools } from './server'

const MAX_BODY_BYTES = 1024 * 1024
const MAX_ACTIVE_REQUESTS = 16
const activeServers = new Set<Server>()

/** Return a JSON-RPC transport error without credentials or internal exception details. */
function rejectRequest(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32_000, message } }))
}

/** Bound JSON parsing before the SDK sees a request; drain rejected bodies without buffering. */
function readMcpBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    const timeout = setTimeout(() => reject(new Error('Request timed out')), 15_000)
    request.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0
        reject(new Error('Request body too large'))
      } else {
        chunks.push(chunk)
      }
    })
    request.once('end', () => {
      clearTimeout(timeout)
      if (size > MAX_BODY_BYTES) {
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    request.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    request.once('aborted', () => {
      clearTimeout(timeout)
      reject(new Error('Request aborted'))
    })
  })
}

/** Handle authenticated stateless Streamable HTTP without sharing protocol request IDs between agents. */
export async function handleMcpRequest(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  response.setHeader('Cache-Control', 'no-store')
  if (!isMcpAvailable()) {
    rejectRequest(response, 503, 'Desktop MCP is disabled or unavailable')
    return
  }
  if (!authorizeMcp(request.headers.authorization)) {
    response.setHeader('WWW-Authenticate', 'Bearer realm="VidBee Desktop MCP"')
    rejectRequest(response, 401, 'Unauthorized')
    return
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    rejectRequest(response, 405, 'Use POST for stateless Streamable HTTP')
    return
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
    rejectRequest(response, 415, 'Content-Type must be application/json')
    return
  }
  if (activeServers.size >= MAX_ACTIVE_REQUESTS) {
    response.setHeader('Retry-After', '1')
    rejectRequest(response, 429, 'Too many concurrent MCP requests')
    return
  }
  const server = createDesktopMcpServer()
  activeServers.add(server)
  /** Close only this request's protocol instance and release its concurrency slot. */
  const close = () => {
    activeServers.delete(server)
    void server.close().catch((error) => log.warn('MCP request cleanup failed:', error))
  }
  response.once('close', close)
  try {
    const body = await readMcpBody(request)
    if (response.destroyed) {
      return
    }
    if (
      !(
        activeServers.has(server) &&
        isMcpAvailable() &&
        authorizeMcp(request.headers.authorization)
      )
    ) {
      rejectRequest(response, 401, 'MCP access changed while reading the request')
      return
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    })
    await server.connect(transport)
    await transport.handleRequest(request, response, body)
  } catch (error) {
    if (!(response.headersSent || response.destroyed)) {
      const message = error instanceof Error ? error.message : ''
      const status =
        message === 'Request body too large' ? 413 : message === 'Request timed out' ? 408 : 400
      rejectRequest(response, status, status === 413 ? message : 'Invalid MCP request')
    }
    close()
  }
}

/** Attach MCP discovery to the real local API address after it has successfully bound. */
export function startDesktopMcp(host: string, port: number): void {
  publishMcpEndpoint(host, port)
  log.info(
    `Desktop MCP available at http://${host}:${port}/mcp with ${desktopMcpTools.length} tools`
  )
}

/** Abort only MCP requests, leaving Desktop tasks and the user's other connections intact. */
export async function closeMcpRequests(): Promise<void> {
  const servers = [...activeServers]
  activeServers.clear()
  await Promise.allSettled(servers.map((server) => server.close()))
}

/** Revoke the live endpoint and close protocol connections during application shutdown. */
export async function stopDesktopMcp(): Promise<void> {
  unpublishMcpEndpoint()
  await closeMcpRequests()
}
