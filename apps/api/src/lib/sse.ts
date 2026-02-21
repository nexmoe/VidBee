import type { ServerResponse } from 'node:http'

const HEARTBEAT_INTERVAL_MS = 15_000

export class SseHub {
  private readonly clients = new Set<ServerResponse>()
  private heartbeatTimer: NodeJS.Timeout | null = null

  addClient(client: ServerResponse): void {
    this.clients.add(client)
    client.write('event: connected\ndata: {"ok":true}\n\n')
    this.ensureHeartbeatTimer()
  }

  removeClient(client: ServerResponse): void {
    this.clients.delete(client)
    if (this.clients.size === 0) {
      this.clearHeartbeatTimer()
    }
  }

  publish(event: string, payload: unknown): void {
    if (this.clients.size === 0) {
      return
    }

    const data = JSON.stringify(payload)
    const message = `event: ${event}\ndata: ${data}\n\n`

    for (const client of this.clients) {
      client.write(message)
    }
  }

  closeAll(): void {
    for (const client of this.clients) {
      client.end()
    }
    this.clients.clear()
    this.clearHeartbeatTimer()
  }

  private ensureHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      return
    }

    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients) {
        client.write(': heartbeat\n\n')
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  private clearHeartbeatTimer(): void {
    if (!this.heartbeatTimer) {
      return
    }
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }
}
