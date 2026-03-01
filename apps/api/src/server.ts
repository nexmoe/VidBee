import { lookup } from 'node:dns/promises'
import type { ServerResponse } from 'node:http'
import net from 'node:net'
import cors from '@fastify/cors'
import { OpenAPIHandler } from '@orpc/openapi/fastify'
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins'
import { RPCHandler } from '@orpc/server/fastify'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import type { DownloadTask } from '@vidbee/downloader-core'
import Fastify from 'fastify'
import { downloaderCore } from './lib/downloader'
import { rpcRouter } from './lib/rpc-router'
import { SseHub } from './lib/sse'

const MAX_PROXY_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_PROXY_REDIRECTS = 5

const isPrivateIpv4 = (ip: string): boolean => {
  const octets = ip.split('.').map((value) => Number.parseInt(value, 10))
  if (octets.length !== 4 || octets.some((value) => Number.isNaN(value))) {
    return false
  }

  const [a, b] = octets
  if (a === 10) {
    return true
  }
  if (a === 127) {
    return true
  }
  if (a === 169 && b === 254) {
    return true
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true
  }
  if (a === 192 && b === 168) {
    return true
  }
  return false
}

const isPrivateIpv6 = (ip: string): boolean => {
  const normalized = ip.toLowerCase()
  if (normalized === '::1') {
    return true
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true
  }
  if (normalized.startsWith('fe80:')) {
    return true
  }
  return false
}

const isBlockedHost = async (url: URL): Promise<boolean> => {
  const hostname = url.hostname.trim().toLowerCase()
  if (!hostname) {
    return true
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '0.0.0.0') {
    return true
  }

  if (net.isIP(hostname) === 4) {
    return isPrivateIpv4(hostname)
  }
  if (net.isIP(hostname) === 6) {
    return isPrivateIpv6(hostname)
  }

  try {
    const records = await lookup(hostname, { all: true, verbatim: true })
    if (records.length === 0) {
      return true
    }
    for (const record of records) {
      if (record.family === 4 && isPrivateIpv4(record.address)) {
        return true
      }
      if (record.family === 6 && isPrivateIpv6(record.address)) {
        return true
      }
    }
    return false
  } catch {
    return true
  }
}

const parseRemoteImageUrl = (value: string): URL | null => {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export const createApiServer = async () => {
  await downloaderCore.initialize()
  const isDev = process.env.NODE_ENV !== 'production'

  const fastify = Fastify({
    logger: true,
    disableRequestLogging: isDev
  })

  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS']
  })

  const rpcHandler = new RPCHandler(rpcRouter)
  const openApiHandler = new OpenAPIHandler(rpcRouter, {
    plugins: [
      new OpenAPIReferencePlugin({
        schemaConverters: [new ZodToJsonSchemaConverter()],
        docsProvider: 'swagger',
        docsPath: '/docs',
        specPath: '/openapi.json',
        docsTitle: 'VidBee API Reference',
        specGenerateOptions: {
          info: {
            title: 'VidBee API',
            version: '1.0.0'
          },
          servers: [{ url: '/openapi' }]
        }
      })
    ]
  })

  const sseHub = new SseHub()

  downloaderCore.on('task-updated', (task: DownloadTask) => {
    sseHub.publish('task-updated', { task })
  })
  downloaderCore.on('queue-updated', (downloads: DownloadTask[]) => {
    sseHub.publish('queue-updated', { downloads })
  })

  fastify.get('/health', async () => {
    return { ok: true }
  })

  fastify.get<{ Querystring: { url?: string } }>('/images/proxy', async (request, reply) => {
    const sourceUrl = request.query.url?.trim()
    if (!sourceUrl) {
      return reply.code(400).send({ message: 'Missing url query parameter.' })
    }

    const parsedUrl = parseRemoteImageUrl(sourceUrl)
    if (!parsedUrl) {
      return reply.code(400).send({ message: 'Invalid remote image URL.' })
    }

    let response: Response | null = null
    let currentUrl = parsedUrl

    for (let redirectCount = 0; redirectCount <= MAX_PROXY_REDIRECTS; redirectCount++) {
      if (await isBlockedHost(currentUrl)) {
        return reply.code(400).send({ message: 'Remote host is not allowed.' })
      }

      try {
        response = await fetch(currentUrl.toString(), {
          signal: AbortSignal.timeout(15_000),
          redirect: 'manual'
        })
      } catch {
        return reply.code(502).send({ message: 'Failed to fetch remote image.' })
      }

      const locationHeader = response.headers.get('location')
      const isRedirect =
        response.status >= 300 &&
        response.status < 400 &&
        typeof locationHeader === 'string' &&
        locationHeader.length > 0
      if (!isRedirect) {
        break
      }

      currentUrl = new URL(locationHeader, currentUrl)
      response.body?.cancel()
    }

    if (!response) {
      return reply.code(502).send({ message: 'Failed to fetch remote image.' })
    }

    if (!response.ok) {
      return reply.code(502).send({
        message: `Remote image request failed with status ${response.status}.`
      })
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.startsWith('image/')) {
      return reply.code(415).send({ message: 'Remote resource is not an image.' })
    }

    const contentLengthHeader = response.headers.get('content-length')
    if (contentLengthHeader) {
      const declaredSize = Number.parseInt(contentLengthHeader, 10)
      if (Number.isFinite(declaredSize) && declaredSize > MAX_PROXY_IMAGE_BYTES) {
        return reply.code(413).send({ message: 'Remote image is too large.' })
      }
    }

    if (!response.body) {
      return reply.code(502).send({ message: 'Remote image response body is empty.' })
    }

    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let totalBytes = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      if (!value) {
        continue
      }

      totalBytes += value.byteLength
      if (totalBytes > MAX_PROXY_IMAGE_BYTES) {
        await reader.cancel()
        return reply.code(413).send({ message: 'Remote image is too large.' })
      }

      chunks.push(Buffer.from(value))
    }

    const imageBuffer = Buffer.concat(chunks, totalBytes)
    const cacheControl = response.headers.get('cache-control')
    const etag = response.headers.get('etag')
    const lastModified = response.headers.get('last-modified')

    reply.header('Content-Type', contentType)
    reply.header('Content-Length', imageBuffer.length.toString())
    reply.header('Cache-Control', cacheControl ?? 'public, max-age=3600')
    if (etag) {
      reply.header('ETag', etag)
    }
    if (lastModified) {
      reply.header('Last-Modified', lastModified)
    }

    return reply.send(imageBuffer)
  })

  fastify.get('/events', async (request, reply) => {
    const requestOrigin = request.headers.origin?.trim()
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': requestOrigin || '*'
    }

    if (requestOrigin) {
      responseHeaders.Vary = 'Origin'
    }

    reply.hijack()
    reply.raw.writeHead(200, responseHeaders)

    const response = reply.raw as ServerResponse
    sseHub.addClient(response)

    request.raw.on('close', () => {
      sseHub.removeClient(response)
    })
  })

  fastify.all('/rpc/*', async (request, reply) => {
    await rpcHandler.handle(request, reply, {
      prefix: '/rpc'
    })
  })

  fastify.all('/docs', async (request, reply) => {
    await openApiHandler.handle(request, reply, {
      prefix: '/'
    })
  })

  fastify.all('/openapi.json', async (request, reply) => {
    await openApiHandler.handle(request, reply, {
      prefix: '/'
    })
  })

  fastify.addHook('onClose', async () => {
    sseHub.closeAll()
  })

  return fastify
}
