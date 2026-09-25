import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { agentFailureFromCloudReason, encodeAgentError } from '../../shared/agent-errors'
import { normalizeCloudContextError } from './agent-cloud-budget'

interface CloudRequestOptions {
  signal: AbortSignal
  request: (requestId: string) => Promise<Response>
  cancel: (requestId: string) => Promise<boolean>
  onRecover?: () => void
}
interface RequestAttempt {
  id: string
  recoveries: number
}

/** Keep recoverable transport failures in the SDK retry protocol rather than exposing an internal 409. */
function recoveryUnavailable(): Response {
  return new Response(
    JSON.stringify({
      error: {
        message:
          'Connection error: The Cloud response could not be resumed. Your progress is saved. Please try again.'
      }
    }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  )
}

/** Decode only the idempotency states this adapter is authorized to recover. */
async function conflictCode(response: Response): Promise<string | undefined> {
  if (response.status !== 409) {
    return undefined
  }
  const body = await response
    .clone()
    .json()
    .catch(() => null)
  return body?.code
}

/** Replay completed work; replace a failed or revoked attempt only after Cloud confirms its terminal state. */
export function createCloudAgentRequestManager(
  wait: (signal: AbortSignal) => Promise<void> = async (signal) => {
    await delay(1000, undefined, { signal })
  }
) {
  const attempts = new Map<string, RequestAttempt>()
  /** Keep one request ID across SDK transport retries and cap replacement attempts across the whole step. */
  return async (key: string, options: CloudRequestOptions): Promise<Response> => {
    let attempt = attempts.get(key)
    if (!attempt) {
      attempt = { id: randomUUID(), recoveries: 0 }
      attempts.set(key, attempt)
    }
    while (true) {
      options.signal.throwIfAborted()
      let response = await normalizeCloudContextError(await options.request(attempt.id))
      let code = await conflictCode(response)
      if (code === 'AI_REQUEST_ALREADY_EXISTS') {
        options.onRecover?.()
      }
      for (let poll = 0; code === 'AI_REQUEST_ALREADY_EXISTS' && poll < 30; poll += 1) {
        await wait(options.signal)
        response = await normalizeCloudContextError(await options.request(attempt.id))
        code = await conflictCode(response)
      }
      if (code === 'AI_REQUEST_ALREADY_EXISTS') {
        // A disconnected Worker can leave a live lease. Revoke it before admitting replacement work.
        const cancelled = await options.cancel(attempt.id).catch(() => false)
        options.signal.throwIfAborted()
        if (cancelled) {
          code = 'AI_AGENT_CALL_FAILED'
        } else {
          // Completion can win the cancellation race; replay it instead of charging another attempt.
          response = await normalizeCloudContextError(await options.request(attempt.id))
          code = await conflictCode(response)
          if (code === 'AI_REQUEST_ALREADY_EXISTS') {
            return recoveryUnavailable()
          }
        }
      }
      if (code !== 'AI_AGENT_CALL_FAILED') {
        return response
      }
      if (attempt.recoveries >= 2) {
        return recoveryUnavailable()
      }
      options.onRecover?.()
      attempt.id = randomUUID()
      attempt.recoveries += 1
    }
  }
}

/** Rewrite one SSE data line, encoding a Cloud failure envelope's reason into its message. */
export function markCloudFailureLine(line: string): string {
  const trimmed = line.startsWith('data:') ? line.slice(5).trim() : undefined
  if (!trimmed || trimmed === '[DONE]' || !trimmed.includes('"error"')) {
    return line
  }
  try {
    const frame = JSON.parse(trimmed) as {
      error?: { reason?: string | null; retryable?: boolean | null; message?: string | null }
    }
    const envelope = frame.error
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      return line
    }
    const failure = agentFailureFromCloudReason(envelope)
    if (!failure) {
      return line
    }
    return `data: ${JSON.stringify({ ...frame, error: { ...envelope, message: encodeAgentError(failure) } })}`
  } catch {
    return line
  }
}

/** Mark Cloud SSE failure frames with structured agent error codes before the SDK reads prose. */
export function markCloudAgentFailures(
  body: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          controller.enqueue(encoder.encode(`${markCloudFailureLine(line)}\n`))
        }
      },
      flush(controller) {
        buffer += decoder.decode()
        if (buffer) {
          controller.enqueue(encoder.encode(markCloudFailureLine(buffer)))
        }
      }
    })
  )
}
