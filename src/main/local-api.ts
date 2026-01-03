import crypto from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import log from 'electron-log/main'

import { downloadEngine } from './lib/download-engine'

const PORT_RANGE_START = 27100
const PORT_RANGE_END = 27120
const TOKEN_TTL_MS = 60_000

type TokenRecord = {
  expiresAt: number
}

let server: http.Server | null = null
let serverPort: number | null = null
const tokens = new Map<string, TokenRecord>()

const isLoopbackAddress = (address?: string | null): boolean => {
  if (!address) return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

const writeJson = (res: http.ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  })
  res.end(JSON.stringify(body))
}

const writeEmpty = (res: http.ServerResponse, status: number): void => {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  })
  res.end()
}

const issueToken = (): string => {
  const token = crypto.randomBytes(16).toString('hex')
  tokens.set(token, { expiresAt: Date.now() + TOKEN_TTL_MS })
  return token
}

const consumeToken = (token?: string | null): boolean => {
  if (!token) return false
  const record = tokens.get(token)
  if (!record) return false
  if (Date.now() > record.expiresAt) {
    tokens.delete(token)
    return false
  }
  tokens.delete(token)
  return true
}

const handleRequest = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> => {
  try {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      writeJson(res, 403, { error: 'Forbidden' })
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

    if (req.method !== 'GET') {
      writeJson(res, 405, { error: 'Method not allowed' })
      return
    }

    if (pathname === '/token') {
      const token = issueToken()
      writeJson(res, 200, { token, expiresInMs: TOKEN_TTL_MS })
      return
    }

    if (pathname === '/video-info') {
      const token = requestUrl.searchParams.get('token')
      if (!consumeToken(token)) {
        writeJson(res, 401, { error: 'Invalid token' })
        return
      }

      const targetUrl = requestUrl.searchParams.get('url')
      if (!targetUrl || !targetUrl.trim()) {
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
      writeJson(res, 200, { ok: true })
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
  if (!server) return

  await new Promise<void>((resolve) => {
    server?.close(() => resolve())
  })

  server = null
  serverPort = null
  tokens.clear()
}
