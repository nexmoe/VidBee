import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'

/** Conservative provider-token heuristic: 1 token ≈ TOKEN_BYTES UTF-8 bytes. */
export const TOKEN_BYTES = 2

/** Named wrapper overheads; every former inline fudge constant lives here. */
export const OVERHEAD = {
  pageWrapper: 256,
  toolPage: 512,
  documentWrapper: 1024,
  userTurnSlack: 2048,
  reviewSlack: 4096
} as const

/** Smallest page that can still include a speaker label and a text slice. */
export const MIN_DOCUMENT_PAGE_BYTES = 2048
/** Smallest serialized document result, including wrapper overhead. */
export const MIN_DOCUMENT_RESULT_BYTES = MIN_DOCUMENT_PAGE_BYTES + OVERHEAD.documentWrapper

export interface WireBudget {
  textBytesPerUnit: number
  imageBytesPerUnit: number
  maxInputUnits: number
}

/** Default Cloud admission formula; keep in sync with Cloud `estimateAgentInput`. */
export const DEFAULT_WIRE_BUDGET: WireBudget = {
  textBytesPerUnit: 2,
  imageBytesPerUnit: 64,
  maxInputUnits: 200_000
}

/**
 * Image token estimate from decoded bytes: clamp(ceil(bytes / 96), 512, 4096).
 *
 * @param decodedBytes Raw image bytes after base64 decode.
 */
export function estimateImageTokens(decodedBytes: number): number {
  if (!Number.isFinite(decodedBytes) || decodedBytes <= 0) {
    return 0
  }
  return Math.min(4096, Math.max(512, Math.ceil(decodedBytes / 96)))
}

/**
 * Single message/tool/system estimator; replaces estimateAgentContext.
 *
 * @param input.systemPrompt Trusted instructions.
 * @param input.messages Provider-visible messages.
 * @param input.tools Tool schemas included in the request.
 * @param input.calibration Observed/estimated EMA factor from BudgetCalibration.
 */
export function estimateTokens(input: {
  systemPrompt?: string
  messages?: AgentMessage[]
  tools?: AgentTool[]
  calibration?: number
}): number {
  let imageTokens = 0
  const visible = (input.messages ?? [])
    .filter(
      (message) =>
        message.role === 'user' ||
        message.role === 'assistant' ||
        message.role === 'toolResult' ||
        message.role === 'custom'
    )
    .map((message) => {
      if (message.role === 'toolResult') {
        return {
          role: message.role,
          content: message.content,
          toolCallId: message.toolCallId,
          toolName: message.toolName
        }
      }
      return { role: message.role, content: message.content }
    })
  const serialized = JSON.stringify(
    {
      messages: visible,
      tools: (input.tools ?? []).map(({ name, description, parameters }) => ({
        name,
        description,
        parameters
      }))
    },
    (key, value) => {
      if (key === 'data' && typeof value === 'string') {
        const decoded = value.startsWith('data:')
          ? Math.ceil(value.length * 0.75)
          : Math.ceil((value.length * 3) / 4)
        imageTokens += estimateImageTokens(decoded)
        return '[image]'
      }
      return value
    }
  )
  const textTokens = Math.ceil(
    Buffer.byteLength(`${input.systemPrompt ?? ''}${serialized}`, 'utf8') / TOKEN_BYTES
  )
  const factor =
    typeof input.calibration === 'number' && Number.isFinite(input.calibration)
      ? input.calibration
      : 1
  return Math.ceil((textTokens + imageTokens) * factor)
}

/**
 * EMA of observed/estimated input tokens, clamped to [0.5, 1.25].
 */
export class BudgetCalibration {
  private current = 1

  /**
   * Fold one observed provider usage sample into the running factor.
   *
   * @param estimatedInput Tokens predicted before the request.
   * @param observedInput Tokens reported in usage.input.
   */
  observe(estimatedInput: number, observedInput: number): void {
    if (!(estimatedInput > 0 && observedInput > 0)) {
      return
    }
    const ratio = observedInput / estimatedInput
    this.current = Math.min(1.25, Math.max(0.5, this.current * 0.7 + ratio * 0.3))
  }

  /** Current calibration factor applied to later estimates. */
  factor(): number {
    return this.current
  }
}

/**
 * Exact mirror of the server admission formula using profile-supplied parameters.
 *
 * @param budget Wire formula advertised in the capabilities profile.
 * @param body Serialized request body (messages + optional tools).
 */
export function wireUnits(
  budget: WireBudget,
  body: { messages: unknown; tools?: unknown; runId?: unknown }
): number {
  let imageBytes = 0
  const text = JSON.stringify(body, (key, value) => {
    if (key === 'url' && typeof value === 'string' && value.startsWith('data:image/')) {
      imageBytes += Math.ceil(value.length * 0.75)
      return ''
    }
    return value
  })
  const textUnits = Math.ceil(Buffer.byteLength(text, 'utf8') / budget.textBytesPerUnit)
  const imageUnits = Math.ceil(imageBytes / budget.imageBytesPerUnit)
  return textUnits + imageUnits
}

/**
 * Keep a usable document page even when the remaining-token estimate is empty.
 *
 * @param input.contextWindow Model context window in provider tokens.
 * @param input.reserveTokens Output + safety reserve.
 * @param input.usedTokens Already occupied tokens (calibrated).
 */
export function documentResultBudget(input: {
  contextWindow: number
  reserveTokens: number
  usedTokens: number
}): number {
  return Math.max(
    MIN_DOCUMENT_RESULT_BYTES,
    TOKEN_BYTES * (input.contextWindow - input.reserveTokens - input.usedTokens)
  )
}

/**
 * Reserve wrapper bytes without reducing a page to nothing.
 *
 * @param maxBytes Total serialized budget.
 * @param overhead JSON wrapper reserved at the end.
 */
export function pageContentBudget(
  maxBytes: number,
  overhead: number = OVERHEAD.pageWrapper
): number {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return 0
  }
  return maxBytes - Math.min(Math.max(0, overhead), maxBytes - 1)
}

/**
 * Review-input byte budget derived from model capacity and the review prompt size.
 *
 * @param input.contextWindow Model context window.
 * @param input.reviewOutputTokens Tokens reserved for the review completion.
 * @param input.contextSafetyTokens Additional unused margin.
 * @param input.promptBytes UTF-8 size of the review system prompt.
 */
export function reviewInputMaxBytes(input: {
  contextWindow: number
  reviewOutputTokens: number
  contextSafetyTokens: number
  promptBytes: number
}): number {
  return Math.max(
    MIN_DOCUMENT_RESULT_BYTES,
    TOKEN_BYTES * (input.contextWindow - input.reviewOutputTokens - input.contextSafetyTokens) -
      input.promptBytes -
      OVERHEAD.reviewSlack
  )
}
