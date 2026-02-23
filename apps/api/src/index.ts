import { createApiServer } from './server'

const host = process.env.VIDBEE_API_HOST?.trim() || '0.0.0.0'
const portValue = Number(process.env.VIDBEE_API_PORT ?? '')
const port = Number.isInteger(portValue) && portValue > 0 ? portValue : 3100

const server = await createApiServer()

try {
  await server.listen({ host, port })
  server.log.info(`VidBee API server listening on http://${host}:${port}`)
} catch (error) {
  server.log.error(error)
  process.exit(1)
}

const shutdown = async (signal: string) => {
  server.log.info(`Received ${signal}, shutting down API server`)
  await server.close()
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
