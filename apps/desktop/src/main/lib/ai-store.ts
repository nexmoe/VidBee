import { randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'
import {
  AGENT_THINKING_LEVELS,
  type AgentThinkingLevel,
  PROVIDER_THINKING_EFFORT_LEVELS,
  type ProviderDefaultThinkingLevel
} from '../../shared/agent-chat'
import {
  aiProviderNeedsApiKey,
  getAiProviderPreset,
  resolveAiProviderBaseUrl
} from '../../shared/ai-presets'
import {
  canonicalizeAiPromptContent,
  createDefaultAiPrompts,
  mergeDefaultAiPrompts
} from '../../shared/ai-prompts'
import type {
  AiPrompt,
  AiPromptIconId,
  AiPromptWriteInput,
  AiProviderConfig,
  AiProviderPresetId,
  AiProviderWriteInput,
  AiSettingsSnapshot
} from '../../shared/ai-types'
import { scopedLoggers } from '../utils/logger'
import { openAiSecret, sealAiSecret } from './ai-secrets'

const ElectronStore = require('electron-store')
const Store = ElectronStore.default || ElectronStore

interface StoredProvider extends AiProviderConfig {
  apiKeySealed: string
}

interface StoredAiState {
  activeProviderId: string | null
  providers: StoredProvider[]
  prompts: AiPrompt[]
}

const log = scopedLoggers.ai

const PRESET_NAMES: Record<AiProviderPresetId, string> = {
  alibaba: 'Alibaba Cloud',
  anthropic: 'Anthropic',
  azure: 'Azure',
  custom: 'Custom',
  deepseek: 'Deepseek',
  fireworks: 'Fireworks',
  google: 'Google',
  groq: 'Groq',
  huggingface: 'Hugging Face',
  lmstudio: 'LMStudio',
  minimax: 'MiniMax',
  mistral: 'Mistral',
  moonshot: 'Moonshot',
  novita: 'Novita',
  ollama: 'Ollama',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  ppio: 'PPIO',
  siliconflow: 'SiliconFlow',
  stepfun: 'StepFun',
  together: 'Together',
  volcengine: 'Volcengine',
  xai: 'xAI',
  zhipu: 'Zhipu'
}

const PROMPT_ICONS = new Set<AiPromptIconId>([
  'list',
  'spell-check',
  'rows-3',
  'highlighter',
  'circle-help',
  'smile',
  'message-circle-question',
  'chart-no-axes-column',
  'repeat-2',
  'git-branch',
  'languages',
  'sparkles'
])

/**
 * True when a stored icon name is one of the supported Lucide ids.
 *
 * @param value Unknown icon from disk or the renderer.
 */
const isPromptIcon = (value: string): value is AiPromptIconId =>
  PROMPT_ICONS.has(value as AiPromptIconId)

/**
 * Persist selected effort levels, dropping unknown names.
 *
 * @param value Dialog payload.
 */
function readThinkingLevels(value: unknown): AgentThinkingLevel[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value)) {
    throw new Error('Invalid thinking levels')
  }
  const levels = [
    ...new Set(
      value.filter((level): level is AgentThinkingLevel =>
        (PROVIDER_THINKING_EFFORT_LEVELS as readonly string[]).includes(level)
      )
    )
  ]
  return levels.length > 0 ? levels : undefined
}

/**
 * Persist the composer default thinking level.
 *
 * @param value Dialog payload.
 */
function readDefaultThinkingLevel(value: unknown): ProviderDefaultThinkingLevel | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === 'auto' || AGENT_THINKING_LEVELS.includes(value as AgentThinkingLevel)) {
    return value as ProviderDefaultThinkingLevel
  }
  throw new Error('Invalid default thinking level')
}

/**
 * Drop the sealed API key before sending a provider to the renderer.
 *
 * @param provider Stored provider including the sealed secret.
 */
const toPublicProvider = (provider: StoredProvider): AiProviderConfig => ({
  id: provider.id,
  presetId: provider.presetId,
  name: provider.name,
  baseUrl: provider.baseUrl,
  modelId: provider.modelId,
  contextWindow: provider.contextWindow,
  vision: provider.vision,
  tools: provider.tools,
  reasoning: provider.reasoning,
  thinkingOnly: provider.thinkingOnly,
  allowDisableThinking: provider.allowDisableThinking,
  thinkingLevels: provider.thinkingLevels,
  defaultThinkingLevel: provider.defaultThinkingLevel,
  maxTokens: provider.maxTokens,
  hasApiKey: provider.apiKeySealed.length > 0,
  createdAt: provider.createdAt,
  updatedAt: provider.updatedAt
})

class AiStore {
  // biome-ignore lint/suspicious/noExplicitAny: electron-store is a CJS default export
  private readonly store: any

  constructor() {
    const now = Date.now()
    this.store = new Store({
      name: 'ai',
      defaults: {
        activeProviderId: null,
        providers: [],
        prompts: createDefaultAiPrompts(now)
      } satisfies StoredAiState
    })
    this.ensurePrompts()
  }

  /**
   * Re-insert missing built-in prompts and drop retired preset ids.
   */
  private ensurePrompts(): void {
    const stored = this.readState()
    const merged = mergeDefaultAiPrompts(stored.prompts)
    if (merged !== stored.prompts) {
      this.store.set('prompts', merged)
    }
  }

  /**
   * Read the full AI settings document.
   */
  private readState(): StoredAiState {
    const now = Date.now()
    const providers = Array.isArray(this.store.get('providers'))
      ? (this.store.get('providers') as StoredProvider[])
      : []
    const prompts = Array.isArray(this.store.get('prompts'))
      ? (this.store.get('prompts') as AiPrompt[])
      : createDefaultAiPrompts(now)
    const activeProviderId = this.store.get('activeProviderId')
    return {
      activeProviderId: typeof activeProviderId === 'string' ? activeProviderId : null,
      providers,
      prompts
    }
  }

  /**
   * Return providers and prompts for the renderer. API keys are never included.
   */
  getSnapshot(): AiSettingsSnapshot {
    const state = this.readState()
    const activeExists = state.providers.some((provider) => provider.id === state.activeProviderId)
    return {
      activeProviderId: activeExists ? state.activeProviderId : null,
      providers: state.providers.map(toPublicProvider),
      prompts: [...state.prompts].sort((left, right) => left.sortOrder - right.sortOrder)
    }
  }

  /**
   * Create or update a provider. An empty API key on update keeps the saved key.
   *
   * @param input Dialog payload from the renderer.
   */
  upsertProvider(input: AiProviderWriteInput): AiProviderConfig {
    const preset = getAiProviderPreset(input.presetId)
    if (!preset) {
      throw new Error('Unknown AI provider')
    }
    const modelId = input.modelId.trim()
    if (!modelId) {
      throw new Error('Model id is required')
    }
    const baseUrl = resolveAiProviderBaseUrl(input.presetId, input.baseUrl)
    if (preset.requiresBaseUrl && !baseUrl) {
      throw new Error('Base URL is required')
    }
    const state = this.readState()
    const now = Date.now()
    const existing = input.id
      ? state.providers.find((provider) => provider.id === input.id)
      : undefined
    const copiedKey = input.copyApiKeyFromId
      ? (state.providers.find((provider) => provider.id === input.copyApiKeyFromId)?.apiKeySealed ??
        '')
      : ''
    const nextKey = input.apiKey?.trim()
      ? sealAiSecret(input.apiKey, safeStorage)
      : (existing?.apiKeySealed ?? copiedKey)
    if (aiProviderNeedsApiKey(input.presetId) && !nextKey) {
      throw new Error('API key is required')
    }
    if (
      input.contextWindow !== undefined &&
      (!Number.isSafeInteger(input.contextWindow) ||
        input.contextWindow < 4096 ||
        input.contextWindow > 2_000_000)
    ) {
      throw new Error('Context window must be between 4096 and 2000000 tokens')
    }
    if (input.vision !== undefined && typeof input.vision !== 'boolean') {
      throw new Error('Invalid image input capability')
    }
    if (input.tools !== undefined && typeof input.tools !== 'boolean') {
      throw new Error('Invalid tool calling capability')
    }
    if (input.reasoning !== undefined && typeof input.reasoning !== 'boolean') {
      throw new Error('Invalid thinking capability')
    }
    if (input.thinkingOnly !== undefined && typeof input.thinkingOnly !== 'boolean') {
      throw new Error('Invalid thinking-only capability')
    }
    if (
      input.allowDisableThinking !== undefined &&
      typeof input.allowDisableThinking !== 'boolean'
    ) {
      throw new Error('Invalid allow-disable-thinking capability')
    }
    const thinkingLevels = readThinkingLevels(input.thinkingLevels)
    const defaultThinkingLevel = readDefaultThinkingLevel(input.defaultThinkingLevel)
    if (
      input.maxTokens !== undefined &&
      (!Number.isSafeInteger(input.maxTokens) ||
        input.maxTokens < 256 ||
        input.maxTokens > 2_000_000 ||
        (input.contextWindow !== undefined && input.maxTokens >= input.contextWindow))
    ) {
      throw new Error('Output tokens must be between 256 and the context window')
    }
    const record: StoredProvider = {
      id: existing?.id ?? randomUUID(),
      presetId: input.presetId,
      name: input.name?.trim() || existing?.name || PRESET_NAMES[input.presetId],
      baseUrl,
      modelId,
      contextWindow: input.contextWindow,
      vision: input.vision,
      tools: input.tools,
      reasoning: input.reasoning,
      thinkingOnly: input.thinkingOnly,
      allowDisableThinking: input.allowDisableThinking,
      thinkingLevels,
      defaultThinkingLevel,
      maxTokens: input.maxTokens,
      hasApiKey: nextKey.length > 0,
      apiKeySealed: nextKey,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    const providers = existing
      ? state.providers.map((provider) => (provider.id === record.id ? record : provider))
      : [...state.providers, record]
    const activeProviderId = state.activeProviderId ?? record.id
    this.store.set({ providers, activeProviderId })
    log.info('ai provider saved', { id: record.id, presetId: record.presetId })
    return toPublicProvider(record)
  }

  /**
   * Remove a provider and clear it as active when needed.
   *
   * @param id Provider id.
   */
  deleteProvider(id: string): AiSettingsSnapshot {
    const state = this.readState()
    const providers = state.providers.filter((provider) => provider.id !== id)
    const activeProviderId =
      state.activeProviderId === id ? (providers[0]?.id ?? null) : state.activeProviderId
    this.store.set({ providers, activeProviderId })
    log.info('ai provider deleted', { id })
    return this.getSnapshot()
  }

  /**
   * Mark a configured provider as the one used for transcript prompts.
   *
   * @param id Provider id, or null to disable all providers.
   */
  setActiveProvider(id: string | null): AiSettingsSnapshot {
    const state = this.readState()
    if (id && !state.providers.some((provider) => provider.id === id)) {
      throw new Error('Unknown AI provider')
    }
    this.store.set('activeProviderId', id)
    return this.getSnapshot()
  }

  /**
   * Return the active provider plus its decrypted API key for the main-process runner.
   */
  getActiveProviderSecret(): { provider: AiProviderConfig; apiKey: string } | null {
    const state = this.readState()
    const provider = state.providers.find((entry) => entry.id === state.activeProviderId)
    if (!provider) {
      return null
    }
    return {
      provider: toPublicProvider(provider),
      apiKey: openAiSecret(provider.apiKeySealed, safeStorage)
    }
  }

  /**
   * Decrypt a stored API key for a connectivity test that left the field blank.
   *
   * @param id Provider id from the edit dialog.
   */
  getProviderSecret(id: string): string {
    const provider = this.readState().providers.find((entry) => entry.id === id)
    return provider ? openAiSecret(provider.apiKeySealed, safeStorage) : ''
  }

  /**
   * Create or update a prompt.
   *
   * @param input Dialog payload from the renderer.
   */
  upsertPrompt(input: AiPromptWriteInput): AiPrompt {
    const title = input.title.trim()
    const content = input.content.trim()
    if (!(title && content)) {
      throw new Error('Prompt title and body are required')
    }
    if (!isPromptIcon(input.icon)) {
      throw new Error('Unknown prompt icon')
    }
    const state = this.readState()
    const now = Date.now()
    const existing = input.id ? state.prompts.find((prompt) => prompt.id === input.id) : undefined
    const nextSort = state.prompts.reduce((max, prompt) => Math.max(max, prompt.sortOrder), -1) + 1
    const record: AiPrompt = {
      id: existing?.id ?? randomUUID(),
      title,
      icon: input.icon,
      content: existing?.isPreset ? canonicalizeAiPromptContent(existing.id, content) : content,
      enabled: input.enabled ?? existing?.enabled ?? true,
      isPreset: existing?.isPreset ?? false,
      sortOrder: existing?.sortOrder ?? nextSort,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    const prompts = existing
      ? state.prompts.map((prompt) => (prompt.id === record.id ? record : prompt))
      : [...state.prompts, record]
    this.store.set('prompts', prompts)
    return record
  }

  /**
   * Remove a prompt. Built-in prompts can be deleted; restoreDefaults puts them back.
   *
   * @param id Prompt id.
   */
  deletePrompt(id: string): AiSettingsSnapshot {
    const state = this.readState()
    this.store.set(
      'prompts',
      state.prompts.filter((prompt) => prompt.id !== id)
    )
    return this.getSnapshot()
  }

  /**
   * Look up a prompt by id.
   *
   * @param id Prompt id.
   */
  getPrompt(id: string): AiPrompt | undefined {
    return this.readState().prompts.find((prompt) => prompt.id === id)
  }

  /**
   * Re-add any missing built-in prompts.
   */
  restoreDefaultPrompts(): AiSettingsSnapshot {
    const state = this.readState()
    this.store.set('prompts', mergeDefaultAiPrompts(state.prompts))
    return this.getSnapshot()
  }
}

export const aiStore = new AiStore()
