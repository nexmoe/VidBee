import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { AgentArtifact, AgentChatRun } from '../../shared/agent-chat'
import { bindArticleImageArtifacts, unboundArticleImageTimes } from '../../shared/agent-markdown'

/** Article body after capture, plus clocks that still have no exclusive frame. */
export interface MaterializedArticleImages {
  text: string
  unresolved: number[]
  /** Present when `capture_frames` threw and the run was not cancelled. */
  captureError?: string
}

/**
 * Explain cited screenshots that remain unbound after materialization.
 *
 * @param times Cited clocks with no exclusive frame. Empty means the article can complete.
 * @param captureError Optional capture failure appended after the missing clocks.
 * @returns User-facing error, or null when every cited screenshot is bound.
 */
export function unresolvedArticleImageMessage(
  times: number[],
  captureError?: string
): string | null {
  if (times.length === 0) {
    return null
  }
  const clocks = times.map((time) => Number(time.toFixed(3))).join(', ')
  const missing = `Cited screenshots at ${clocks}s are still missing.`
  const reason = captureError?.replace(/\s+/g, ' ').trim()
  return reason ? `${missing} ${reason}` : missing
}

/**
 * Record unbound screenshots so run settlement cannot mark the article complete.
 *
 * An existing run error is left in place. The screenshot note is still stored on
 * the article-images tool when that tool row exists.
 *
 * @returns The message that blocks completion, or null when every image is bound.
 */
export function rejectUnboundArticleImages(
  run: Pick<AgentChatRun, 'error' | 'errorCode' | 'tools'>,
  unresolved: number[],
  captureError?: string
): string | null {
  const missing = unresolvedArticleImageMessage(unresolved, captureError)
  if (!missing) {
    return null
  }
  const tool = run.tools.find((item) => item.id === 'article-images')
  if (tool) {
    tool.status = 'error'
    tool.detail = missing
  }
  if (!run.error) {
    run.error = missing
    run.errorCode = 'INTERNAL'
  }
  return missing
}

/**
 * Read screenshot ids from one `capture_frames` result.
 *
 * Cached frames keep the run that stored them. These ids are still the frames
 * this article asked for, so binding may use them.
 */
function artifactIdsFromCapture(result: unknown): string[] {
  if (!result || typeof result !== 'object' || !('details' in result)) {
    return []
  }
  const details = result.details
  if (!details || typeof details !== 'object' || !('artifacts' in details)) {
    return []
  }
  const { artifacts } = details
  if (!Array.isArray(artifacts)) {
    return []
  }
  const ids: string[] = []
  for (const item of artifacts) {
    if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') {
      ids.push(item.id.toLowerCase())
    }
  }
  return ids
}

/**
 * Capture cited screenshot times and rewrite the article onto real artifact ids.
 *
 * Each still-unbound clock is captured exactly, so two citations inside one short
 * cue stay two frames. A capture failure is returned instead of dropped.
 * `unresolved` clocks still need a frame, so the caller must not report the article
 * as fully complete.
 */
export async function materializeAgentArticleImages(input: {
  text: string
  artifacts: AgentArtifact[]
  runId: string
  tools: AgentTool[]
  signal: AbortSignal
  onCapture?: (status: 'running' | 'completed' | 'error') => void
}): Promise<MaterializedArticleImages> {
  const timestamps = unboundArticleImageTimes(input.text, input.artifacts, input.runId)
  const capture = input.tools.find((tool) => tool.name === 'capture_frames')
  let captureError: string | undefined
  const returnedIds = new Set<string>()
  if (timestamps.length && capture) {
    input.signal.throwIfAborted()
    input.onCapture?.('running')
    try {
      const result = await capture.execute(
        'article-images',
        { timestamps, exact: true },
        input.signal
      )
      for (const id of artifactIdsFromCapture(result)) {
        returnedIds.add(id)
      }
    } catch (error) {
      if (input.signal.aborted) {
        input.onCapture?.('error')
        throw input.signal.reason instanceof Error
          ? input.signal.reason
          : new Error('The agent run was cancelled')
      }
      captureError = error instanceof Error ? error.message : String(error)
    }
  }
  const text = bindArticleImageArtifacts(input.text, input.artifacts, input.runId, returnedIds)
  const unresolved = unboundArticleImageTimes(text, input.artifacts, input.runId, returnedIds)
  if (timestamps.length && capture) {
    input.onCapture?.(unresolved.length ? 'error' : 'completed')
  } else if (unresolved.length) {
    input.onCapture?.('error')
  }
  return captureError ? { text, unresolved, captureError } : { text, unresolved }
}
