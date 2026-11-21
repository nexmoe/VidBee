import type { AiProviderConfig } from './ai-types'

/** One settings entry containing all models configured for the same provider. */
export interface AiProviderGroup {
  id: string
  name: string
  providers: AiProviderConfig[]
}

/** Recover the provider name from model suffixes added by the legacy dialog. */
export function aiProviderName(provider: AiProviderConfig): string {
  if (provider.groupId) {
    return provider.name
  }
  if (provider.name === provider.modelId) {
    return ''
  }
  if (provider.name.endsWith(` · ${provider.modelId}`)) {
    return provider.name.split(' · ')[0]
  }
  return provider.name
}

/** Group models by stable identity, with a name and endpoint fallback for old settings. */
export function groupAiProviders(providers: AiProviderConfig[]): AiProviderGroup[] {
  const groups = new Map<string, AiProviderGroup>()
  for (const provider of providers) {
    const name = aiProviderName(provider)
    const key = provider.groupId
      ? `group:${provider.groupId}`
      : JSON.stringify([provider.presetId, provider.baseUrl.replace(/\/+$/, ''), name])
    const group = groups.get(key)
    if (group) {
      group.providers.push(provider)
    } else {
      groups.set(key, { id: provider.groupId ?? provider.id, name, providers: [provider] })
    }
  }
  return [...groups.values()]
}
