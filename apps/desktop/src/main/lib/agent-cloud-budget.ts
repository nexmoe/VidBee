/** Match Cloud's UTF-8 and decoded-image budget against the actual serialized request. */
export function estimateCloudAgentInput(input: {
  runId: string
  messages: unknown
  tools?: unknown
}): number {
  let imageBytes = 0
  const text = JSON.stringify(input, (key, value) => {
    if (key === 'url' && typeof value === 'string' && value.startsWith('data:image/')) {
      imageBytes += Math.ceil(value.length * 0.75)
      return ''
    }
    return value
  })
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 2) + Math.ceil(imageBytes / 64)
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
    !(
      failure?.code === 'AI_AGENT_CAPABILITY_EXCEEDED' &&
      failure?.error === "Request exceeds this Cloud model's context, output or image capabilities."
    )
  ) {
    return response
  }
  return new Response(
    JSON.stringify({
      error: {
        message: 'context_length_exceeded: Cloud input budget requires compaction.',
        type: 'invalid_request_error',
        code: 'context_length_exceeded'
      }
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } }
  )
}
