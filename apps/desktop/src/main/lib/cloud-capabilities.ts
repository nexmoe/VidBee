import { AgentUserError } from '../../shared/agent-errors'
import {
  type AgentModelProfile,
  cloudProfileRequestHeaders,
  readAgentModelProfile,
  throwIfCloudProfileUnsupported
} from './agent-model-profile'

const CAPABILITIES_TTL_MS = 5 * 60_000
const MAX_CACHED_PROFILES = 8

interface CloudCapabilities {
  baseUrl: string
  cookie: string
  payload: Record<string, unknown>
  profile: AgentModelProfile
}

interface CachedCapabilities {
  expiresAt: number
  promise: Promise<CloudCapabilities>
}

const profiles = new Map<string, CachedCapabilities>()
let currentSession = ''

/** Retain a bounded number of selected-model and default-model cache keys. */
function rememberCapabilities(key: string, entry: CachedCapabilities): void {
  profiles.set(key, entry)
  while (profiles.size > MAX_CACHED_PROFILES) {
    const oldest = profiles.keys().next().value
    if (oldest !== undefined) {
      profiles.delete(oldest)
    }
  }
}

/** Let one caller cancel without aborting a discovery request shared by other windows. */
function awaitCapabilities(
  promise: Promise<CloudCapabilities>,
  signal?: AbortSignal
): Promise<CloudCapabilities> {
  if (!signal) {
    return promise
  }
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    /** Release a cancelled caller immediately while the shared request stays bounded. */
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      }
    )
  })
}

/** Share validated discovery for five minutes, isolated by session, API and selected model. */
export async function loadCloudCapabilities(
  modelId?: string,
  signal?: AbortSignal
): Promise<CloudCapabilities> {
  signal?.throwIfAborted()
  const { authClient, getDesktopAuthApiUrl } = await import('./auth-client')
  signal?.throwIfAborted()
  const baseUrl = getDesktopAuthApiUrl()
  const cookie = authClient.getCookie()
  const session = JSON.stringify([baseUrl, cookie])
  if (session !== currentSession) {
    profiles.clear()
    currentSession = session
  }
  const key = modelId ?? ''
  const existing = profiles.get(key)
  if (existing && existing.expiresAt > Date.now()) {
    return awaitCapabilities(existing.promise, signal)
  }
  /** Cache only successful, readable profiles; failures can be retried on the next action. */
  const read = async (): Promise<CloudCapabilities> => {
    const response = await fetch(
      `${baseUrl}/api/ai/agent/capabilities${modelId ? `?modelId=${encodeURIComponent(modelId)}` : ''}`,
      {
        headers: { Cookie: cookie, ...cloudProfileRequestHeaders() },
        signal: AbortSignal.timeout(10_000)
      }
    )
    const payload: unknown = await response.json().catch(() => null)
    throwIfCloudProfileUnsupported(response.status, payload)
    if (response.status === 401) {
      throw new AgentUserError('Sign in required')
    }
    if (!response.ok) {
      throw new Error('Cloud models are unavailable')
    }
    const profile = readAgentModelProfile(payload)
    return { baseUrl, cookie, profile, payload: payload as Record<string, unknown> }
  }
  const entry: CachedCapabilities = { expiresAt: Number.POSITIVE_INFINITY, promise: read() }
  entry.promise = entry.promise.then(
    (value) => {
      entry.expiresAt = Date.now() + CAPABILITIES_TTL_MS
      if (
        session === currentSession &&
        profiles.get(key) === entry &&
        typeof value.payload.id === 'string'
      ) {
        rememberCapabilities(value.payload.id, entry)
      }
      return value
    },
    (error: unknown) => {
      if (profiles.get(key) === entry) {
        profiles.delete(key)
      }
      throw error
    }
  )
  rememberCapabilities(key, entry)
  return awaitCapabilities(entry.promise, signal)
}
