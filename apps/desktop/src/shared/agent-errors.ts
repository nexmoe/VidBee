import { isRecoverableAiPromptError } from './ai-run'

export type AgentErrorCode =
  | 'TRANSPORT_LOST'
  | 'PROVIDER_UNAVAILABLE'
  | 'CONTEXT_OVERFLOW'
  | 'OUTPUT_TRUNCATED'
  | 'STREAM_INTERRUPTED'
  | 'RESUME_FAILED'
  | 'BILLING_REJECTED'
  | 'CONTENT_FILTERED'
  | 'PROVIDER_REJECTED'
  | 'CANCELLED'
  | 'STALLED'
  | 'PERSISTENCE_FAILED'
  | 'TIMEOUT'
  | 'INTERNAL'

export interface AgentFailure {
  code: AgentErrorCode
  message: string
  retryable: boolean
}

const RETRYABLE_CODES = new Set<AgentErrorCode>([
  'TRANSPORT_LOST',
  'PROVIDER_UNAVAILABLE',
  'CONTEXT_OVERFLOW',
  'OUTPUT_TRUNCATED',
  'STREAM_INTERRUPTED',
  'RESUME_FAILED'
])

const KNOWN_CODES = new Set<AgentErrorCode>([
  'TRANSPORT_LOST',
  'PROVIDER_UNAVAILABLE',
  'CONTEXT_OVERFLOW',
  'OUTPUT_TRUNCATED',
  'STREAM_INTERRUPTED',
  'RESUME_FAILED',
  'BILLING_REJECTED',
  'CONTENT_FILTERED',
  'PROVIDER_REJECTED',
  'CANCELLED',
  'STALLED',
  'PERSISTENCE_FAILED',
  'TIMEOUT',
  'INTERNAL'
])

/** Versioned Cloud failure classes; keep in sync with Cloud `describeProviderFailure` reasons. */
const CLOUD_REASON_CODES: Record<string, AgentErrorCode> = {
  'provider-content-filter': 'CONTENT_FILTERED',
  truncated: 'OUTPUT_TRUNCATED',
  incomplete: 'STREAM_INTERRUPTED',
  'stream-interrupted': 'STREAM_INTERRUPTED',
  'provider-connection': 'TRANSPORT_LOST',
  'provider-http': 'TRANSPORT_LOST',
  'timeout-or-cancel': 'TRANSPORT_LOST',
  'provider-rate-limit': 'PROVIDER_UNAVAILABLE',
  'credit-budget-exhausted': 'BILLING_REJECTED',
  // Upstream context limits are terminal for this request; only our own HTTP-level
  // overflow protocol (sdkOverflowResponse) may trigger compaction retries.
  'provider-context-limit': 'PROVIDER_REJECTED',
  'response-too-large': 'PROVIDER_REJECTED',
  'provider-auth': 'PROVIDER_REJECTED',
  'provider-invalid-request': 'PROVIDER_REJECTED',
  'provider-invalid-role': 'PROVIDER_REJECTED',
  'provider-model-unavailable': 'PROVIDER_REJECTED',
  'provider-unsupported-parameter': 'PROVIDER_REJECTED',
  'empty-output': 'PROVIDER_REJECTED',
  persistence: 'PROVIDER_REJECTED'
}

/**
 * Classify a Cloud error envelope by its versioned reason token, never message prose.
 *
 * The envelope's explicit retryable flag is authoritative; the code's default applies
 * only when Cloud omitted it. Unknown future reasons still classify by that flag.
 *
 * @param envelope Structured error fields from a Cloud stream failure frame.
 * @returns Structured failure, or undefined when the envelope carries no reason contract.
 */
export function agentFailureFromCloudReason(envelope: {
  reason?: string | null
  retryable?: boolean | null
  message?: string | null
}): AgentFailure | undefined {
  const reason = envelope.reason?.trim()
  if (!reason && typeof envelope.retryable !== 'boolean') {
    return undefined
  }
  const mapped = reason ? CLOUD_REASON_CODES[reason] : undefined
  const retryable =
    typeof envelope.retryable === 'boolean'
      ? envelope.retryable
      : mapped
        ? isRetryableAgentError(mapped)
        : false
  const code = mapped ?? (retryable ? 'STREAM_INTERRUPTED' : 'PROVIDER_REJECTED')
  return {
    code,
    message: envelope.message?.trim() || `Cloud request failed (${reason ?? 'unknown reason'})`,
    retryable
  }
}

const MARKER = /^\[VB:([A-Z_]+)\]\s*(.*)$/s
const CONNECTION_PREFIX = /^(?:connection error:\s*)+/i
const LEGACY_INCOMPLETE =
  /terminated|connection stopped|before the response finished|output limit|Cloud response could not be resumed/i

/**
 * Encode a failure into transportable text: "[VB:CODE] message".
 *
 * @param failure Structured failure to serialize.
 */
export function encodeAgentError(failure: AgentFailure): string {
  const message = failure.message.trim()
  return message ? `[VB:${failure.code}] ${message}` : `[VB:${failure.code}]`
}

/**
 * True when this code is eligible for SDK connection retries.
 *
 * @param code Machine-readable failure code.
 */
export function isRetryableAgentError(code: AgentErrorCode): boolean {
  return RETRYABLE_CODES.has(code)
}

/**
 * Parse "[VB:CODE] ..." markers; the only legacy fallback regex lives here.
 *
 * @param text Encoded or historical error text.
 */
export function parseAgentError(text: string | undefined): AgentFailure {
  const raw = text?.trim() ?? ''
  if (!raw) {
    return { code: 'INTERNAL', message: '', retryable: false }
  }
  const unmarked = raw.replace(CONNECTION_PREFIX, '').trim()
  const marked = unmarked.match(MARKER)
  if (marked && KNOWN_CODES.has(marked[1] as AgentErrorCode)) {
    const code = marked[1] as AgentErrorCode
    return { code, message: marked[2]?.trim() || raw, retryable: isRetryableAgentError(code) }
  }
  return classifyLegacyError(raw)
}

/**
 * Rewrite a retryable failure into the SDK's `Connection error` vocabulary.
 *
 * The Pi SDK retries only messages containing `Connection error`. This is the
 * only translator that speaks that vocabulary.
 *
 * @param failure Structured failure from parseAgentError or a classifier.
 */
export function toSdkRetryMessage(failure: AgentFailure): string | undefined {
  const text = failure.message.trim()
  if (!(failure.retryable && text)) {
    return undefined
  }
  if (CONNECTION_PREFIX.test(text)) {
    return undefined
  }
  return `Connection error: ${encodeAgentError(failure)}`
}

/**
 * Error subclass whose message is intended for the user verbatim.
 */
export class AgentUserError extends Error {
  readonly code: AgentErrorCode
  readonly retryable: boolean

  constructor(message: string, code: AgentErrorCode = 'INTERNAL', retryable = false) {
    super(message)
    this.name = 'AgentUserError'
    this.code = code
    this.retryable = retryable
  }

  /** Convert this error into the shared failure shape. */
  toFailure(): AgentFailure {
    return { code: this.code, message: this.message, retryable: this.retryable }
  }
}

/**
 * Classify unmarked historical or Cloud prose using the former recovery regex.
 *
 * @param text User-facing or transport error text.
 */
function classifyLegacyError(text: string): AgentFailure {
  const retryable = isRecoverableAiPromptError(text)
  if (
    /context[_\s.-]?length|input too large|AI_AGENT_INPUT_TOO_LARGE|AI_AGENT_CONTEXT_EXCEEDED/i.test(
      text
    )
  ) {
    return { code: 'CONTEXT_OVERFLOW', message: text, retryable: true }
  }
  if (/output limit|stopReason length|truncated/i.test(text)) {
    return { code: 'OUTPUT_TRUNCATED', message: text, retryable: true }
  }
  if (/could not be resumed|AI_AGENT_RESUME/i.test(text)) {
    return { code: 'RESUME_FAILED', message: text, retryable: true }
  }
  if (/content.?filter/i.test(text)) {
    return { code: 'CONTENT_FILTERED', message: text, retryable: false }
  }
  if (/credits|quota|\b402\b|entitlement|BILLING/i.test(text) && !retryable) {
    return { code: 'BILLING_REJECTED', message: text, retryable: false }
  }
  if (/\bcancel(?:led)?\b|\baborted\b/i.test(text) && !retryable) {
    return { code: 'CANCELLED', message: text, retryable: false }
  }
  if (/stalled|repeating the same action/i.test(text)) {
    return { code: 'STALLED', message: text, retryable: false }
  }
  if (/persist the agent conversation|PERSISTENCE/i.test(text)) {
    return { code: 'PERSISTENCE_FAILED', message: text, retryable: false }
  }
  if (/\btimeout\b|no progress for/i.test(text) && !retryable) {
    return { code: 'TIMEOUT', message: text, retryable: false }
  }
  if (
    LEGACY_INCOMPLETE.test(text) ||
    /connection (?:stopped|reset|closed)|terminated/i.test(text)
  ) {
    return { code: 'STREAM_INTERRUPTED', message: text, retryable: true }
  }
  if (retryable) {
    return {
      code: /\b(?:429|503|overload|rate.?limit)/i.test(text)
        ? 'PROVIDER_UNAVAILABLE'
        : 'TRANSPORT_LOST',
      message: text,
      retryable: true
    }
  }
  return { code: 'INTERNAL', message: text, retryable: false }
}
