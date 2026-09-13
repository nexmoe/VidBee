import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { AgentArtifact } from '../../shared/agent-chat'
import { bindArticleImageArtifacts, unboundArticleImageTimes } from '../../shared/agent-markdown'

/** Capture cited screenshot times and rewrite the article onto real artifact ids. */
export async function materializeAgentArticleImages(input: {
  text: string
  artifacts: AgentArtifact[]
  runId: string
  tools: AgentTool[]
  signal: AbortSignal
  onCapture?: (status: 'running' | 'completed' | 'error') => void
}): Promise<string> {
  const timestamps = unboundArticleImageTimes(input.text, input.artifacts, input.runId).slice(0, 6)
  const capture = input.tools.find((tool) => tool.name === 'capture_frames')
  if (timestamps.length && capture) {
    input.signal.throwIfAborted()
    input.onCapture?.('running')
    try {
      await capture.execute('article-images', { timestamps }, input.signal)
      input.onCapture?.('completed')
    } catch {
      input.onCapture?.('error')
      if (input.signal.aborted) {
        throw input.signal.reason instanceof Error
          ? input.signal.reason
          : new Error('The agent run was cancelled')
      }
    }
  }
  return bindArticleImageArtifacts(input.text, input.artifacts, input.runId)
}
