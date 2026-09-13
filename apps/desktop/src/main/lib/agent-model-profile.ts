import type { Api, Model } from '@earendil-works/pi-ai'
import {
  AGENT_THINKING_LEVELS,
  type AgentThinkingLevel,
  type AgentThinkingOptions
} from '../../shared/agent-chat'
import { AGENT_TOOL_BYTES } from './agent-memory'

const CONTEXT_SAFETY_TOKENS = 4096
const SUMMARY_MAX_TOKENS = 8192
const REVIEW_TIMEOUT_MS = 60_000

/** Document shape Desktop understands; keep in sync with Cloud `AGENT_PROFILE_VERSION`. */
export const AGENT_PROFILE_VERSION = 2
/** Advertised by Desktop so Cloud can refuse unreadable documents. Keep in sync with Cloud. */
export const AGENT_PROFILE_HEADER = 'X-VidBee-Agent-Profile'

export class CloudAgentProfileError extends Error {
  readonly code = 'CLIENT_UPDATE_REQUIRED' as const

  constructor(
    message = 'This Cloud model profile needs a newer VidBee Desktop. Please update the app.'
  ) {
    super(message)
    this.name = 'CloudAgentProfileError'
  }
}

export interface AgentHarnessTuning {
  outputMaxTokens?: number
  defaultThinkingLevel: AgentThinkingLevel
}

export interface AgentModelProfile {
  version: 2
  modelRelease: string
  contextWindow: number
  maxTokens: number
  vision: boolean
  thinkingLevels?: AgentThinkingLevel[]
  harness: AgentHarnessTuning
}

/** Fail closed with a stable prefix so callers can match Cloud profile errors. */
function invalidCloudProfile(reason: string): never {
  throw new Error(`Invalid Cloud agent model profile: ${reason}`)
}

/**
 * Headers Desktop sends on capabilities discovery so Cloud can negotiate.
 */
export const cloudProfileRequestHeaders = (): Record<string, string> => ({
  [AGENT_PROFILE_HEADER]: String(AGENT_PROFILE_VERSION)
})

/**
 * Map a 426 capabilities response into an update-required error.
 *
 * @param status HTTP status from `/api/ai/agent/capabilities`.
 * @param payload JSON body, if any.
 */
export const throwIfCloudProfileUnsupported = (status: number, payload: unknown): void => {
  if (status !== 426) {
    return
  }
  const body = payload && typeof payload === 'object' ? (payload as { error?: unknown }) : {}
  throw new CloudAgentProfileError(
    typeof body.error === 'string' && body.error.trim()
      ? body.error
      : 'This Cloud model profile needs a newer VidBee Desktop. Please update the app.'
  )
}

/**
 * Composer options advertised by a validated Cloud profile.
 *
 * @param profile Normalized model profile.
 */
export const thinkingOptionsFromProfile = (profile: AgentModelProfile): AgentThinkingOptions => ({
  levels: profile.thinkingLevels ?? [...AGENT_THINKING_LEVELS],
  defaultLevel: profile.harness.defaultThinkingLevel,
  vision: profile.vision
})

/**
 * Safe Composer defaults when Cloud discovery fails. Run admission still fail-closes.
 */
export const fallbackThinkingOptions = (): AgentThinkingOptions => {
  const levels = [...AGENT_THINKING_LEVELS]
  return { levels, defaultLevel: levels.includes('low') ? 'low' : levels[0], vision: false }
}

/** Known thinking levels advertised by Cloud, dropping names this Desktop build does not understand. */
function knownThinkingLevels(
  value: unknown,
  defaultThinkingLevel: AgentThinkingLevel
): AgentThinkingLevel[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Invalid Cloud agent thinking capabilities')
  }
  const known = [
    ...new Set(
      value.filter((level): level is AgentThinkingLevel => AGENT_THINKING_LEVELS.includes(level))
    )
  ]
  if (known.length === 0 || !known.includes(defaultThinkingLevel)) {
    throw new Error('Invalid Cloud agent thinking capabilities')
  }
  return known
}

/** Validate resource controls and normalize older profiles without retaining their internal tuning. */
export function readAgentModelProfile(value: unknown): AgentModelProfile {
  if (!value || typeof value !== 'object') {
    invalidCloudProfile('response is not an object')
  }
  const profile = value as Omit<AgentModelProfile, 'version'> & { version: number }
  if (!Number.isSafeInteger(profile.version) || profile.version < 1) {
    invalidCloudProfile(`unsupported version ${String(profile.version)}`)
  }
  if (typeof profile.modelRelease !== 'string') {
    invalidCloudProfile('modelRelease must be a string')
  }
  if (typeof profile.vision !== 'boolean') {
    invalidCloudProfile('vision must be a boolean')
  }
  if (!Number.isSafeInteger(profile.contextWindow) || profile.contextWindow < 4096) {
    invalidCloudProfile('contextWindow is out of range')
  }
  if (
    !Number.isSafeInteger(profile.maxTokens) ||
    profile.maxTokens < 256 ||
    profile.maxTokens >= profile.contextWindow
  ) {
    invalidCloudProfile('maxTokens is out of range')
  }
  if (!profile.harness || typeof profile.harness !== 'object') {
    invalidCloudProfile('harness is missing')
  }
  const legacy = profile.version === 1
  const outputMaxTokens = profile.harness.outputMaxTokens ?? (legacy ? profile.maxTokens : 0)
  const defaultThinkingLevel = profile.harness.defaultThinkingLevel
  if (
    !Number.isSafeInteger(outputMaxTokens) ||
    outputMaxTokens < 256 ||
    !AGENT_THINKING_LEVELS.includes(defaultThinkingLevel)
  ) {
    throw new Error('Invalid Cloud agent resource controls')
  }
  return {
    version: 2,
    modelRelease: profile.modelRelease,
    contextWindow: profile.contextWindow,
    maxTokens: profile.maxTokens,
    vision: profile.vision,
    thinkingLevels: knownThinkingLevels(profile.thinkingLevels, defaultThinkingLevel),
    harness: { outputMaxTokens, defaultThinkingLevel }
  }
}

/**
 * Grow the next completion after a length stop so reasoning cannot consume the entire answer.
 *
 * @param input.current Tokens used for the truncated turn.
 * @param input.contextWindow Model context window.
 * @param input.reasoningTokens Thinking tokens reported on the truncated turn.
 */
export function expandTruncatedOutputBudget(input: {
  current: number
  contextWindow: number
  reasoningTokens?: number
}): number {
  const cap = Math.max(256, Math.floor(input.contextWindow / 4) || 8192)
  const current = input.current > 0 ? input.current : Math.min(8192, cap)
  const reasoning = Math.max(0, input.reasoningTokens ?? 0)
  return Math.min(cap, Math.max(current * 4, current + reasoning + current, current))
}

/** Derive internal memory and tool budgets from model capacity and the requested output budget. */
export function agentRuntimePolicy(model: Model<Api>, tuning?: AgentHarnessTuning) {
  const contextWindow = model.contextWindow
  const contextCap = Math.max(256, Math.floor(contextWindow / 4) || 8192)
  const advertised = model.maxTokens > 0 ? model.maxTokens : 8192
  const requested =
    tuning?.outputMaxTokens && tuning.outputMaxTokens > 0 ? tuning.outputMaxTokens : advertised
  const outputTokens = Math.min(requested, advertised, contextCap)
  const contextSafetyTokens = Math.min(CONTEXT_SAFETY_TOKENS, Math.floor(contextWindow / 8))
  const reserveTokens = outputTokens + contextSafetyTokens
  const summaryOutputTokens = Math.min(SUMMARY_MAX_TOKENS, outputTokens)
  const summaryTargetTokens = Math.floor(summaryOutputTokens / 2)
  const defaultThinkingLevel = tuning?.defaultThinkingLevel ?? 'off'
  return {
    outputTokens,
    summaryOutputTokens,
    contextSafetyTokens,
    reserveTokens,
    keepRecentTokens: summaryTargetTokens,
    summaryTargetTokens,
    toolResultMaxBytes: Math.min(AGENT_TOOL_BYTES, 2 * (contextWindow - reserveTokens)),
    reviewOutputTokens: summaryOutputTokens,
    reviewTimeoutMs: REVIEW_TIMEOUT_MS,
    articleSectionTokens: Math.min(outputTokens, contextWindow - reserveTokens),
    defaultThinkingLevel,
    summaryThinkingLevel: defaultThinkingLevel
  }
}
