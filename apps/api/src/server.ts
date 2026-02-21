import type { ServerResponse } from 'node:http'
import cors from '@fastify/cors'
import { RPCHandler } from '@orpc/server/fastify'
import type { DownloadTask } from '@vidbee/downloader-core'
import Fastify from 'fastify'
import { downloaderCore } from './lib/downloader'
import { rpcRouter } from './lib/rpc-router'
import { SseHub } from './lib/sse'

export const createApiServer = async () => {
  await downloaderCore.initialize()

  const fastify = Fastify({
    logger: true
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
