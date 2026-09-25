import type { IncomingHttpHeaders } from 'node:http'
import { isExtensionOrigin } from './extension-origin'

export const LOCAL_API_PORT_START = 27_100
export const LOCAL_API_PORT_END = 27_120

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

export type LocalApiCaller =
  | { kind: 'cli' }
  | { kind: 'extension'; origin: string }
  | { kind: 'rejected'; reason: 'host' | 'origin' }

/**
 * True when Host is loopback and, if a port is present, inside the Desktop range.
 *
 * @param hostHeader Raw `Host` header.
 * @param portStart Inclusive start of the local API port range.
 * @param portEnd Inclusive end of the local API port range.
 */
export function isTrustedLoopbackHost(
  hostHeader: string | undefined,
  portStart = LOCAL_API_PORT_START,
  portEnd = LOCAL_API_PORT_END
): boolean {
  if (!hostHeader) {
    return false
  }
  const parsed = parseHostHeader(hostHeader)
  if (!(parsed && LOOPBACK_HOSTS.has(parsed.hostname))) {
    return false
  }
  if (parsed.port === null) {
    return true
  }
  return parsed.port >= portStart && parsed.port <= portEnd
}

/**
 * Classify a loopback caller: CLI, a browser extension, or a website.
 * Edge/Chrome may omit Origin on extension fetches to 127.0.0.1; accept the
 * matching `X-VidBee-Extension` header in that case.
 *
 * @param headers Incoming request headers.
 */
export function classifyLocalApiCaller(headers: IncomingHttpHeaders): LocalApiCaller {
  const host = headerValue(headers.host)
  if (!isTrustedLoopbackHost(host)) {
    return { kind: 'rejected', reason: 'host' }
  }
  const origin = headerValue(headers.origin)
  const extension = headerValue(headers['x-vidbee-extension'])
  if (
    (headers.origin !== undefined && !origin) ||
    (headers['x-vidbee-extension'] !== undefined && !extension)
  ) {
    return { kind: 'rejected', reason: 'origin' }
  }
  if (origin) {
    if (origin === 'null' || !isExtensionOrigin(origin)) {
      return { kind: 'rejected', reason: 'origin' }
    }
    if (extension && extension !== origin) {
      return { kind: 'rejected', reason: 'origin' }
    }
    return { kind: 'extension', origin }
  }
  if (extension) {
    if (!isExtensionOrigin(extension)) {
      return { kind: 'rejected', reason: 'origin' }
    }
    return { kind: 'extension', origin: extension }
  }
  return { kind: 'cli' }
}

/**
 * Parse `Host` into hostname plus optional port. Rejects non-loopback-shaped values.
 *
 * @param hostHeader Raw `Host` header.
 */
export function parseHostHeader(
  hostHeader: string
): { hostname: string; port: number | null } | null {
  const raw = hostHeader.trim().toLowerCase()
  if (!raw) {
    return null
  }
  if (raw.startsWith('[')) {
    const close = raw.indexOf(']')
    if (close < 1) {
      return null
    }
    const hostname = raw.slice(1, close)
    const rest = raw.slice(close + 1)
    if (!rest) {
      return { hostname, port: null }
    }
    if (!rest.startsWith(':')) {
      return null
    }
    const port = parsePort(rest.slice(1))
    return port === null ? null : { hostname, port }
  }
  const colon = raw.lastIndexOf(':')
  if (colon >= 0 && raw.indexOf(':') === colon) {
    const port = parsePort(raw.slice(colon + 1))
    if (port === null) {
      return null
    }
    return { hostname: raw.slice(0, colon), port }
  }
  if (raw.includes(':')) {
    return null
  }
  return { hostname: raw, port: null }
}

/**
 * Read a single header string, rejecting duplicates.
 *
 * @param value Header value from Node.
 */
function headerValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return value && value === value.trim() ? value : undefined
  }
  return undefined
}

/**
 * Parse a decimal TCP port.
 *
 * @param value Port substring.
 */
function parsePort(value: string): number | null {
  if (!/^\d{1,5}$/.test(value)) {
    return null
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return null
  }
  return port
}
