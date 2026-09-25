import { randomBytes } from 'node:crypto'

export const EXTENSION_TOKEN_TTL_MS = 60_000
const MAX_PENDING_TOKENS = 128

/** Create a bounded store of expiring, origin-bound, one-use handshake tokens. */
export function createExtensionTokenStore() {
  const tokens = new Map<string, { origin: string; expiresAt: number }>()
  return {
    /** Issue a token after pruning expired handshakes; fail closed at capacity. */
    issue(origin: string): string | null {
      const now = Date.now()
      for (const [token, record] of tokens) {
        if (record.expiresAt <= now) {
          tokens.delete(token)
        }
      }
      if (tokens.size >= MAX_PENDING_TOKENS) {
        return null
      }
      const token = randomBytes(32).toString('hex')
      tokens.set(token, { origin, expiresAt: now + EXTENSION_TOKEN_TTL_MS })
      return token
    },
    /** Consume only a fresh token presented by the extension that requested it. */
    consume(token: string | null | undefined, origin: string): boolean {
      if (!token) {
        return false
      }
      const record = tokens.get(token)
      if (!record) {
        return false
      }
      if (record.expiresAt <= Date.now()) {
        tokens.delete(token)
        return false
      }
      if (record.origin !== origin) {
        return false
      }
      tokens.delete(token)
      return true
    },
    /** Forget every pending handshake when Desktop stops. */
    clear(): void {
      tokens.clear()
    }
  }
}
