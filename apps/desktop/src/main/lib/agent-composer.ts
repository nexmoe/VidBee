import type { AgentComposerOptions } from '../../shared/extension-chat'
import { getAgentThinkingOptions } from './agent-chat-runner'
import { aiStore } from './ai-store'
import { loadCloudModels } from './cloud-models'

/** Read public model labels and capabilities without sending keys or endpoint settings to clients. */
export async function getAgentComposerOptions(): Promise<AgentComposerOptions> {
  const [catalog, thinking] = await Promise.all([
    loadCloudModels().catch(() => ({ models: [], defaultModelId: 'default' })),
    getAgentThinkingOptions()
  ])
  const snapshot = aiStore.getSnapshot()
  return {
    models: [
      ...(catalog.models.length
        ? catalog.models.map((model) => ({
            value: `cloud:${model.id}`,
            label: model.name,
            description: `${model.multiplier}×`
          }))
        : [{ value: 'cloud', label: 'VidBee Cloud' }]),
      ...snapshot.providers.map((provider) => ({
        value: provider.id,
        label: provider.modelId || provider.name,
        description: provider.modelId === provider.name ? undefined : provider.name,
        presetId: provider.presetId,
        modelId: provider.modelId
      }))
    ],
    selected:
      snapshot.activeProviderId ??
      (catalog.models.length
        ? `cloud:${snapshot.cloudModelId ?? catalog.defaultModelId}`
        : 'cloud'),
    thinking
  }
}

/** Persist the same active model used by Desktop and validate managed model choices upstream. */
export async function selectAgentComposerModel(value: string): Promise<void> {
  if (value.startsWith('cloud:')) {
    const id = value.slice(6)
    const catalog = await loadCloudModels()
    if (!catalog.models.some((model) => model.id === id)) {
      throw new Error('Cloud model is unavailable')
    }
    aiStore.setCloudModel(id)
  } else {
    aiStore.setActiveProvider(value === 'cloud' ? null : value)
  }
}
