import { encodeAgentError } from '../../shared/agent-errors'
import { DEFAULT_WIRE_BUDGET, type WireBudget, wireUnits } from './agent-budget'

/**
 * Match Cloud's UTF-8 and decoded-image budget against the actual serialized request.
 *
 * @param input Serialized completions body.
 * @param budget Profile-supplied formula; defaults to the current Cloud constants.
 */
export function estimateCloudAgentInput(
  input: { runId: string; messages: unknown; tools?: unknown },
  budget: WireBudget = DEFAULT_WIRE_BUDGET
): number {
  return wireUnits(budget, input)
}

/**
 * Fabricated provider overflow used to ask the SDK to compact through the fetch seam.
 * This is the only sanctioned constructor for a fake context_length_exceeded response.
 */
export function sdkOverflowResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: encodeAgentError({
          code: 'CONTEXT_OVERFLOW',
          message: 'context_length_exceeded: Cloud input budget requires compaction.',
          retryable: true
        }),
        type: 'invalid_request_error',
        code: 'context_length_exceeded'
      }
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } }
  )
}

/** Normalize only Cloud's known budget rejection into the provider overflow protocol. */
export async function normalizeCloudContextError(response: Response): Promise<Response> {
  if (response.status !== 400) {
    return response
  }
  const failure = await response
    .clone()
    .json()
    .catch(() => null)
  if (
    failure?.code !== 'AI_AGENT_CONTEXT_EXCEEDED' &&
    failure?.code !== 'AI_AGENT_INPUT_TOO_LARGE'
  ) {
    return response
  }
  return sdkOverflowResponse()
}
