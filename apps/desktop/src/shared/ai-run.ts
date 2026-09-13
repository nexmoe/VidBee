import type { AiPromptErrorCode, AiPromptRunSnapshot, AiPromptRunStatus } from './ai-types'

const TERMINAL_PROMPT_RUN_STATUSES = new Set<AiPromptRunStatus>(['completed', 'aborted', 'error'])

const AUTH_PATTERN = /401|403|unauthor|forbidden|api key|apikey|invalid key|authentication/i
const NETWORK_PATTERN =
  /enotfound|econnrefused|econnreset|etimedout|timed out|network|fetch failed|failed to fetch|dns|certificate|ssl|eai_again|connection error|connection refused|econn|socket hang up|und_err|ehostunreach|enetunreach|epipe|connect timeout|could not reach vidbee cloud/i
const TERSE_CONNECTION_ERROR = /^connection error\.?$/i
const CONNECTION_ERROR_DETAIL =
  'Could not connect to the AI provider. Check your internet, proxy, and the provider Base URL.'
const CLOUD_CONNECTION_DETAIL =
  'Could not reach VidBee Cloud. Check your internet connection, then try again.'
const INCOMPLETE_STREAM_PATTERN = /stream ended without finish_reason/i

/**
 * Empty snapshot used before the first run of a prompt.
 *
 * @param downloadId Download or settings-test id.
 * @param promptId Prompt id.
 * @param now Timestamp.
 */
export const idlePromptRunSnapshot = (
  downloadId: string,
  promptId: string,
  now: number = Date.now()
): AiPromptRunSnapshot => ({
  downloadId,
  promptId,
  status: 'idle',
  text: '',
  thinking: '',
  thinkingMs: 0,
  error: null,
  errorCode: null,
  updatedAt: now
})

/**
 * Settings "test prompt" ids are not real downloads and must not be stored.
 *
 * @param downloadId Download or settings-test id.
 */
export const isEphemeralPromptRunDownloadId = (downloadId: string): boolean =>
  downloadId.startsWith('__')

/**
 * True when a snapshot is a finished result that should survive a restart.
 *
 * @param status Run lifecycle.
 */
export const isTerminalPromptRunStatus = (status: AiPromptRunStatus): boolean =>
  TERMINAL_PROMPT_RUN_STATUSES.has(status)

/** Visual mark shown on a transcript prompt tab. Idle and aborted stay unmarked. */
export type PromptTabIndicator = 'running' | 'completed' | 'error'

/**
 * Map a prompt-run lifecycle onto the tab indicator, or null when nothing should show.
 * Completed and error marks hide after the user opens that tab.
 *
 * @param status Latest run status for that prompt.
 * @param viewed True when the current completed/error result has already been opened.
 */
export const promptTabIndicator = (
  status: AiPromptRunStatus,
  viewed = false
): PromptTabIndicator | null => {
  if (status === 'running') {
    return 'running'
  }
  if (status === 'completed' || status === 'error') {
    return viewed ? null : status
  }
  return null
}

/**
 * Walk `error.cause` so a terse SDK message still includes the syscall.
 *
 * @param error Thrown value from the provider client.
 */
export const flattenErrorMessage = (error: unknown): string => {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && !seen.has(current) && parts.length < 5) {
    seen.add(current)
    if (typeof current === 'string') {
      const text = current.trim()
      if (text) {
        parts.push(text)
      }
      break
    }
    if (current instanceof Error) {
      const text = current.message.trim()
      if (text) {
        parts.push(text)
      }
      current = current.cause
      continue
    }
    if (typeof current === 'object' && 'message' in current) {
      const text = String((current as { message?: unknown }).message ?? '').trim()
      if (text) {
        parts.push(text)
      }
      current = (current as { cause?: unknown }).cause
      continue
    }
    break
  }
  return [...new Set(parts)].join('\n')
}

/**
 * Expand a terse connection failure so the details box is readable.
 *
 * @param message Flattened provider or runner error.
 * @param viaCloud True when this run used VidBee Cloud instead of a local key.
 */
export const formatAiPromptError = (message: string, viaCloud = false): string => {
  const trimmed = message.trim()
  const lines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const extra = lines.filter((line) => !TERSE_CONNECTION_ERROR.test(line))
  const hadTerseConnection = extra.length !== lines.length
  if (!hadTerseConnection) {
    return trimmed
  }
  const head = viaCloud ? CLOUD_CONNECTION_DETAIL : CONNECTION_ERROR_DETAIL
  const rest = extra.join('\n')
  if (!rest) {
    return head
  }
  if (viaCloud && /could not reach vidbee cloud/i.test(rest)) {
    return rest
  }
  return `${head}\n${rest}`
}

/**
 * True when the model wrote tokens but the SSE stream omitted finish_reason.
 *
 * @param message Flattened provider or runner error.
 */
export const isIncompleteAiStreamError = (message: string): boolean =>
  INCOMPLETE_STREAM_PATTERN.test(message)

/** Five recovery attempts after the initial request, with increasing backoff. */
export const AI_PROMPT_RECOVERY_DELAYS_MS = [1000, 2000, 4000, 8000, 16_000] as const

/**
 * Failure classes VidBee Cloud reports as retryable on its structured `reason` field.
 * Mirrors `PROVIDER_FAILURE_RETRYABLE` in the Cloud worker; both sides are covered by
 * a shared contract test. Local providers have no `reason`, so they fall back to prose.
 */
const CLOUD_RETRYABLE_REASONS = new Set([
  'incomplete',
  'provider-connection',
  'provider-http',
  'provider-rate-limit',
  'stream-interrupted',
  'timeout-or-cancel',
  'truncated'
])

/**
 * Decide recovery from a Cloud failure reason when present, else from message prose.
 *
 * Prefer this over the prose-only classifier wherever a Cloud error envelope is in hand:
 * the reason token is a versioned contract, the message is human-facing copy that may be
 * reworded at any time.
 *
 * @param failure Error envelope from the Cloud stream, or a bare provider message.
 */
export const isRecoverableAiFailure = (failure: {
  reason?: string | null
  retryable?: boolean | null
  message?: string | null
}): boolean => {
  if (typeof failure.retryable === 'boolean') {
    return failure.retryable
  }
  if (failure.reason) {
    return CLOUD_RETRYABLE_REASONS.has(failure.reason)
  }
  return isRecoverableAiPromptError(failure.message ?? '')
}

/** Retry transient upstream failures and truncated output without retrying permanent rejections. */
export const isRecoverableAiPromptError = (message: string): boolean => {
  if (
    /\b(?:400|401|402|403|404|422)\b|authentication|unauthori[sz]ed|forbidden|api.key|credits|quota|context.length|context.limit|content.filter|certificate|invalid (?:request|model|parameter)/i.test(
      message
    )
  ) {
    return false
  }
  return (
    isIncompleteAiStreamError(message) ||
    /\b(?:408|425|429|500|502|503|504|520|521|522|523|524|529)\b|rate.?limit|overload|temporarily unavailable|service unavailable|bad gateway|timed out|timeout|connection (?:stopped before|error|reset|closed)|could not (?:reach|connect)|econnreset|econnrefused|eai_again|etimedout|epipe|socket|fetch failed|failed to fetch|network|terminated|before the response finished|reached its output limit/i.test(
      message
    )
  )
}

/**
 * Map a provider/model failure to a guidance code.
 *
 * @param message Error text from pi-agent or the local runner.
 * @param emptyText True when the model finished without writing anything.
 */
export const classifyAiPromptError = (
  message: string | null | undefined,
  emptyText = false
): AiPromptErrorCode => {
  const text = message?.trim() ?? ''
  if (/no ai provider/i.test(text)) {
    return 'no-provider'
  }
  if (/missing an api key/i.test(text)) {
    return 'missing-api-key'
  }
  if (/missing a model id/i.test(text)) {
    return 'missing-model'
  }
  if (/unknown prompt/i.test(text)) {
    return 'unknown-prompt'
  }
  if (/transcript is empty/i.test(text)) {
    return 'empty-transcript'
  }
  if (/AI_CREDIT_QUOTA_EXCEEDED|not enough ai credits|\b402\b/i.test(text)) {
    return 'credits-exhausted'
  }
  if (/sign in required/i.test(text) || text.includes('UNAUTHORIZED')) {
    return 'sign-in-required'
  }
  if (AUTH_PATTERN.test(text)) {
    return 'auth'
  }
  if (
    /AI_REQUEST_ALREADY_EXISTS|AI_AGENT_CALL_FAILED|This operation is already running or has failed/i.test(
      text
    ) ||
    NETWORK_PATTERN.test(text) ||
    isRecoverableAiPromptError(text)
  ) {
    return 'network'
  }
  if (text) {
    return 'unknown'
  }
  return emptyText ? 'empty-output' : 'unknown'
}

/**
 * True when the user should be sent to provider settings to fix this failure.
 *
 * @param code Classified error.
 */
export const aiPromptErrorNeedsProviderSettings = (code: AiPromptErrorCode | null): boolean =>
  code === 'sign-in-required' ||
  code === 'credits-exhausted' ||
  code === 'no-provider' ||
  code === 'missing-api-key' ||
  code === 'missing-model' ||
  code === 'auth' ||
  code === 'network' ||
  code === 'empty-output' ||
  code === 'unknown'
