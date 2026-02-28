import type { ServerResponse } from 'node:http'
import cors from '@fastify/cors'
import { RPCHandler } from '@orpc/server/fastify'
import type { DownloadTask } from '@vidbee/downloader-core'
import Fastify from 'fastify'
import { downloaderCore } from './lib/downloader'
import { rpcRouter } from './lib/rpc-router'
import { SseHub } from './lib/sse'

const MAX_PROXY_IMAGE_BYTES = 10 * 1024 * 1024

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

    let response: Response
    try {
      response = await fetch(parsedUrl.toString(), {
        signal: AbortSignal.timeout(15_000),
        redirect: 'follow'
      })
    } catch {
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

  fastify.addHook('onClose', async () => {
    sseHub.closeAll()
  })

  return fastify
}
