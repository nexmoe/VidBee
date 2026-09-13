import { resolve } from 'node:path'
import { electronClient } from '@better-auth/electron/client'
import { storage } from '@better-auth/electron/storage'
import type {
  DesktopAiCreditHistory,
  DesktopAiCreditHistoryCursor,
  DesktopAiCreditReceipt,
  DesktopAiCreditSourceUsage,
  DesktopAiCreditUsage,
  DesktopAiReservation,
  DesktopAuthUser,
  DesktopGiftedCreditRecord,
  DesktopInvitationOverview,
  DesktopInvitedUser,
  DesktopPaginatedResult
} from '@shared/types/auth'
import { createAuthClient } from 'better-auth/client'
import { app, type BrowserWindow } from 'electron'
import { setupRendererContentSecurityPolicy } from './renderer-csp'

const AUTH_PROTOCOL = 'com.vidbee'
const AUTH_CALLBACK_PATH = '/auth/callback'
const AUTH_CHANNEL_PREFIX = 'vidbee-auth'
const DEVELOPMENT_API_URL =
  process.env.PORTLESS_URL?.replace('desktop.vidbee.', 'cloud.vidbee.') || 'http://localhost:3000'
const DEVELOPMENT_SIGN_IN_URL = new URL(
  '/sign-in/',
  process.env.PORTLESS_URL?.replace('desktop.vidbee.', 'home.vidbee.') || 'http://localhost:4321'
).href
const PRODUCTION_API_URL = 'https://api.vidbee.org'
const PRODUCTION_SIGN_IN_URL = 'https://vidbee.org/sign-in/'

/** Resolve an optional process override with a stable development or production fallback. */
function resolveAuthUrl(name: string, developmentUrl: string, productionUrl: string): string {
  const override = process.env[name]?.trim()
  if (override) {
    return override
  }
  return app.isPackaged ? productionUrl : developmentUrl
}

/** Restrict renderer-visible account data to the basic VidBee profile fields. */
function sanitizeUser(user: {
  email: string
  id: string
  image?: string | null
  name: string
}): DesktopAuthUser {
  return {
    email: user.email,
    id: user.id,
    image: user.image ?? null,
    name: user.name
  }
}

const authApiUrl = resolveAuthUrl('VIDBEE_AUTH_API_URL', DEVELOPMENT_API_URL, PRODUCTION_API_URL)

export const authClient = createAuthClient({
  baseURL: authApiUrl,
  plugins: [
    electronClient({
      callbackPath: AUTH_CALLBACK_PATH,
      channelPrefix: AUTH_CHANNEL_PREFIX,
      clientID: 'electron',
      protocol: {
        scheme: AUTH_PROTOCOL
      },
      sanitizeUser: (user) => sanitizeUser(user) as typeof user,
      signInURL: resolveAuthUrl(
        'VIDBEE_AUTH_SIGN_IN_URL',
        DEVELOPMENT_SIGN_IN_URL,
        PRODUCTION_SIGN_IN_URL
      ),
      storage: storage({ projectName: 'vidbee-auth' })
    })
  ]
})

/** Validate one granted or purchased credit bucket before it crosses IPC. */
function isDesktopAiCreditSourceUsage(value: unknown): value is DesktopAiCreditSourceUsage {
  if (!value || typeof value !== 'object') {
    return false
  }
  const usage = value as Partial<DesktopAiCreditSourceUsage>
  return (
    typeof usage.quotaCredits === 'number' &&
    typeof usage.remainingCredits === 'number' &&
    typeof usage.reservedCredits === 'number' &&
    typeof usage.usedCredits === 'number' &&
    typeof usage.expiringSoonCredits === 'number'
  )
}

/** Copy a validated per-source balance without forwarding extra server fields. */
function desktopAiCreditSourceUsage(usage: DesktopAiCreditSourceUsage): DesktopAiCreditSourceUsage {
  return {
    expiringSoonCredits: usage.expiringSoonCredits,
    quotaCredits: usage.quotaCredits,
    remainingCredits: usage.remainingCredits,
    reservedCredits: usage.reservedCredits,
    usedCredits: usage.usedCredits
  }
}

/** Validate the narrow AI credit response before it crosses the renderer boundary. */
function isDesktopAiCreditUsage(value: unknown): value is DesktopAiCreditUsage {
  if (!value || typeof value !== 'object') {
    return false
  }
  const usage = value as Partial<DesktopAiCreditUsage>
  if (
    !(
      typeof usage.quotaCredits === 'number' &&
      typeof usage.remainingCredits === 'number' &&
      typeof usage.reservedCredits === 'number' &&
      typeof usage.usedCredits === 'number' &&
      typeof usage.expiringSoonCredits === 'number' &&
      typeof usage.byFeature?.transcription === 'number' &&
      typeof usage.byFeature.prompt === 'number'
    )
  ) {
    return false
  }
  if (usage.bySource === undefined) {
    return true
  }
  return (
    isDesktopAiCreditSourceUsage(usage.bySource.granted) &&
    isDesktopAiCreditSourceUsage(usage.bySource.purchased)
  )
}

/** Call one authenticated oRPC endpoint without exposing the session cookie. */
async function callAuthenticatedRpc(route: string, input?: unknown): Promise<unknown> {
  const response = await fetch(`${authApiUrl}/rpc/${route}`, {
    body: JSON.stringify(input === undefined ? {} : { json: input }),
    headers: {
      'Content-Type': 'application/json',
      Cookie: authClient.getCookie()
    },
    method: 'POST'
  })
  if (!response.ok) {
    throw new Error('Unable to load account data.')
  }
  const payload = (await response.json()) as { json?: unknown }
  return payload.json
}

/** Validate account-owned task details before exposing them to the renderer. */
function isDesktopAiReservation(value: unknown): value is DesktopAiReservation {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as Partial<DesktopAiReservation>
  return (
    typeof row.requestId === 'string' &&
    row.requestId.length <= 128 &&
    (row.status === 'reserved' || row.status === 'reconciling') &&
    (row.taskLabel === null || typeof row.taskLabel === 'string') &&
    [
      row.createdAt,
      row.deadlineAt,
      row.expiresAt,
      row.lastHeartbeatAt,
      row.lastProgressAt,
      row.reservedCredits
    ].every((value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  )
}

/** Read live holds without exposing provider identifiers or session credentials. */
export async function getDesktopAiReservations(): Promise<DesktopAiReservation[]> {
  const result = await callAuthenticatedRpc('aiCredits/reservations')
  if (!Array.isArray(result) || result.length > 50 || !result.every(isDesktopAiReservation)) {
    throw new Error('The AI reservation response is invalid.')
  }
  return result.map((row) => ({
    createdAt: row.createdAt,
    deadlineAt: row.deadlineAt,
    expiresAt: row.expiresAt,
    lastHeartbeatAt: row.lastHeartbeatAt,
    lastProgressAt: row.lastProgressAt,
    requestId: row.requestId,
    reservedCredits: row.reservedCredits,
    status: row.status,
    taskLabel: row.taskLabel
  }))
}

/** Validate exact amounts and the narrow billing receipt contract before crossing IPC. */
function isDesktopAiCreditReceipt(value: unknown): value is DesktopAiCreditReceipt {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as Partial<DesktopAiCreditReceipt>
  return (
    [row.id, row.requestId, row.feature, row.status].every(
      (value) => typeof value === 'string' && value.length <= 256
    ) &&
    [row.createdAt, row.credits, row.refundedCredits].every(
      (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ) &&
    [row.taskLabel, row.basis, row.pricingVersion, row.model].every(
      (value) => value === null || (typeof value === 'string' && value.length <= 1024)
    ) &&
    [row.inputTokens, row.outputTokens].every(
      (value) =>
        value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    ) &&
    (row.refundedCredits ?? 0) <= (row.credits ?? 0)
  )
}

/** Validate the opaque page position without allowing arbitrary account parameters. */
function isDesktopAiCreditHistoryCursor(value: unknown): value is DesktopAiCreditHistoryCursor {
  if (!value || typeof value !== 'object') {
    return false
  }
  const cursor = value as Partial<DesktopAiCreditHistoryCursor>
  return (
    typeof cursor.at === 'number' &&
    Number.isSafeInteger(cursor.at) &&
    cursor.at >= 0 &&
    typeof cursor.id === 'string' &&
    cursor.id.length > 0 &&
    cursor.id.length <= 256
  )
}

/** Read this session's paginated charges, uncharged tasks and compensating refunds. */
export async function getDesktopAiCreditHistory(
  cursor?: DesktopAiCreditHistoryCursor
): Promise<DesktopAiCreditHistory> {
  if (cursor !== undefined && !isDesktopAiCreditHistoryCursor(cursor)) {
    throw new Error('Invalid AI credit history cursor.')
  }
  const result = (await callAuthenticatedRpc(
    'aiCredits/history',
    cursor ? { cursor } : undefined
  )) as Partial<DesktopAiCreditHistory> | null
  if (
    !(result && Array.isArray(result.items)) ||
    result.items.length > 50 ||
    !result.items.every(isDesktopAiCreditReceipt) ||
    (result.nextCursor !== null && !isDesktopAiCreditHistoryCursor(result.nextCursor))
  ) {
    throw new Error('The AI credit history response is invalid.')
  }
  return { items: result.items, nextCursor: result.nextCursor }
}

/** Ask the server to revoke a task before its unused reservation is released. */
export async function cancelDesktopAiReservation(requestId: string): Promise<void> {
  if (!requestId.trim() || requestId.length > 128) {
    throw new Error('Invalid AI request ID.')
  }
  const response = await fetch(`${authApiUrl}/api/ai/prompt/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authClient.getCookie() },
    body: JSON.stringify({ requestId })
  })
  if (!response.ok) {
    throw new Error('Unable to cancel the AI task.')
  }
}

/** Read the signed-in user's AI credits without exposing the stored session cookie. */
export async function getDesktopAiCreditUsage(): Promise<DesktopAiCreditUsage> {
  const result = await callAuthenticatedRpc('aiCredits/me')
  if (!isDesktopAiCreditUsage(result)) {
    throw new Error('The AI credit response is invalid.')
  }
  return {
    byFeature: { prompt: result.byFeature.prompt, transcription: result.byFeature.transcription },
    bySource: result.bySource
      ? {
          granted: desktopAiCreditSourceUsage(result.bySource.granted),
          purchased: desktopAiCreditSourceUsage(result.bySource.purchased)
        }
      : undefined,
    expiringSoonCredits: result.expiringSoonCredits,
    interruptedCredits:
      typeof result.interruptedCredits === 'number' && Number.isFinite(result.interruptedCredits)
        ? Math.max(0, result.interruptedCredits)
        : undefined,
    quotaCredits: result.quotaCredits,
    remainingCredits: result.remainingCredits,
    reservedCredits: result.reservedCredits,
    reconcilingCredits:
      typeof result.reconcilingCredits === 'number' && Number.isFinite(result.reconcilingCredits)
        ? Math.max(0, result.reconcilingCredits)
        : undefined,
    usedCredits: result.usedCredits
  }
}

/** Return the current user's permanent invitation code and totals. */
export async function getDesktopInvitationOverview(): Promise<DesktopInvitationOverview> {
  return (await callAuthenticatedRpc('invites/overview')) as DesktopInvitationOverview
}

/** Return one privacy-safe page of users invited by the current account. */
export async function getDesktopInvitedUsers(
  cursor?: string
): Promise<DesktopPaginatedResult<DesktopInvitedUser>> {
  return (await callAuthenticatedRpc('invites/list', {
    cursor,
    limit: 20
  })) as DesktopPaginatedResult<DesktopInvitedUser>
}

/** Return one page of gifted credit ledger records for the current account. */
export async function getDesktopGiftedCreditRecords(
  cursor?: string
): Promise<DesktopPaginatedResult<DesktopGiftedCreditRecord>> {
  return (await callAuthenticatedRpc('aiCredits/grants', {
    cursor,
    limit: 20
  })) as DesktopPaginatedResult<DesktopGiftedCreditRecord>
}

/** Return the authenticated API URL for managed main-process requests. */
export function getDesktopAuthApiUrl(): string {
  return authApiUrl
}

/** Register Better Auth protocol, CSP, and IPC integration before Electron becomes ready. */
export function setupDesktopAuth(getWindow: () => BrowserWindow | null): void {
  authClient.setupMain({ bridges: true, csp: false, getWindow, scheme: false })
  setupRendererContentSecurityPolicy(authApiUrl)
}

/** Return whether a URL is the isolated Better Auth callback. */
export function isDesktopAuthCallback(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return (
      parsedUrl.protocol === `${AUTH_PROTOCOL}:` &&
      `/${parsedUrl.hostname}${parsedUrl.pathname}` === AUTH_CALLBACK_PATH &&
      parsedUrl.hash.startsWith('#token=')
    )
  } catch {
    return false
  }
}

/** Exchange a validated Better Auth callback token for the encrypted desktop session. */
export async function handleDesktopAuthCallback(url: string): Promise<boolean> {
  if (!isDesktopAuthCallback(url)) {
    return false
  }

  const token = new URL(url).hash.slice('#token='.length)
  await authClient.authenticate({ token })
  return true
}

/** Register the auth callback scheme without taking over the app's existing instance lock. */
export function registerDesktopAuthProtocol(): boolean {
  if (process.defaultApp && typeof process.argv[1] === 'string') {
    return app.setAsDefaultProtocolClient(AUTH_PROTOCOL, process.execPath, [
      resolve(process.argv[1])
    ])
  }
  return app.setAsDefaultProtocolClient(AUTH_PROTOCOL)
}

export { AUTH_CHANNEL_PREFIX, AUTH_PROTOCOL }
