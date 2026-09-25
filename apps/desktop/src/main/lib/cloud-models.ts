import type { CloudModelOption } from '../../shared/ai-types'
import { cloudProfileRequestHeaders } from './agent-model-profile'

/** Load the authenticated public catalog without exposing credentials. */
export async function loadCloudModels(): Promise<{
  models: CloudModelOption[]
  defaultModelId: string
}> {
  const { authClient, getDesktopAuthApiUrl } = await import('./auth-client')
  const response = await fetch(`${getDesktopAuthApiUrl()}/api/ai/agent/capabilities`, {
    headers: { Cookie: authClient.getCookie(), ...cloudProfileRequestHeaders() },
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) {
    throw new Error('Cloud models are unavailable')
  }
  const payload = (await response.json()) as {
    models?: CloudModelOption[]
    defaultModelId?: string
  }
  // Older Cloud deployments expose a single unnamed model.
  if (!payload.models) {
    return { models: [], defaultModelId: 'default' }
  }
  if (
    !(Array.isArray(payload.models) && payload.models.length) ||
    payload.models.some(
      (model) =>
        !model ||
        typeof model.id !== 'string' ||
        typeof model.name !== 'string' ||
        typeof model.multiplier !== 'number' ||
        !Number.isFinite(model.multiplier) ||
        model.multiplier <= 0
    ) ||
    !payload.models.some((model) => model.id === payload.defaultModelId)
  ) {
    throw new Error('Invalid Cloud model catalog')
  }
  return {
    models: payload.models.map(({ id, name, multiplier }) => ({ id, name, multiplier })),
    defaultModelId: payload.defaultModelId as string
  }
}
