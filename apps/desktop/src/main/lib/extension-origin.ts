import type { IncomingMessage, ServerResponse } from 'node:http'
import { VIDBEE_EXTENSION_ORIGIN } from '@vidbee/downloader-core/cookie-setup'

const EXTENSION_ORIGIN =
  /^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/
const developmentOrigins = new Set<string>()

/** Allow explicitly configured unpacked extensions only in an unpackaged Desktop app. */
export function configureDevelopmentExtensionOrigins(isPackaged: boolean, origins?: string): void {
  developmentOrigins.clear()
  if (isPackaged) {
    return
  }
  for (const origin of origins?.split(',') ?? []) {
    const value = origin.trim()
    if (EXTENSION_ORIGIN.test(value)) {
      developmentOrigins.add(value)
    }
  }
}

/**
 * True only for the published VidBee extension or an explicit development origin.
 *
 * @param value Candidate Origin header.
 */
export function isExtensionOrigin(value: string): boolean {
  return value === VIDBEE_EXTENSION_ORIGIN || developmentOrigins.has(value)
}

/**
 * Require browser-supplied Origin for writes; capability-protected reads may omit it.
 *
 * @param req Incoming loopback request.
 */
export function extensionRequestOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin
  const extension = req.headers['x-vidbee-extension'] ?? origin
  if (typeof extension !== 'string' || !isExtensionOrigin(extension)) {
    return null
  }
  if (origin !== undefined && origin !== extension) {
    return null
  }
  if (req.method !== 'GET' && origin !== extension) {
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
  res.setHeader('Vary', 'Origin')
  res.setHeader('Cache-Control', 'no-store')
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
