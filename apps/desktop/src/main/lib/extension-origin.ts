import type { IncomingMessage, ServerResponse } from 'node:http'

export const EXTENSION_ORIGIN =
  /^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[a-f0-9-]{36})$/i

/**
 * True when the value is a Chrome or Firefox extension origin.
 *
 * @param value Candidate Origin header.
 */
export function isExtensionOrigin(value: string): boolean {
  return EXTENSION_ORIGIN.test(value)
}

/**
 * Permit browser extension callers, never ordinary website origins.
 *
 * @param req Incoming loopback request.
 */
export function extensionRequestOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin
  const extension =
    req.headers['x-vidbee-extension'] ?? (req.method === 'OPTIONS' ? origin : undefined)
  if (typeof extension !== 'string' || !EXTENSION_ORIGIN.test(extension)) {
    return null
  }
  if (origin && origin !== extension) {
    return null
  }
  return extension
}

/**
 * Restrict CORS to the calling extension origin.
 *
 * @param res HTTP response.
 * @param origin Verified extension origin.
 */
export function applyExtensionCors(res: ServerResponse, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-VidBee-Extension')
}

/**
 * Return a private, non-cacheable JSON response to the initiating extension.
 *
 * @param res HTTP response.
 * @param status HTTP status.
 * @param body JSON body.
 */
export function replyExtensionJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}
