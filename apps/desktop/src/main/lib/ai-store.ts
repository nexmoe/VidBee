import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, safeStorage } from 'electron'
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
import { createDefaultAiPrompts, mergeDefaultAiPrompts } from '../../shared/ai-prompts'
import type {
  AiPrompt,
  AiPromptWriteInput,
  AiProviderConfig,
  AiProviderPresetId,
  AiProviderWriteInput,
  AiSettingsSnapshot
} from '../../shared/ai-types'
import { scopedLoggers } from '../utils/logger'
import { formatAgentSkillDocument, parseAgentSkill } from './agent-skill-document'
import { AgentSkillFiles } from './agent-skill-files'
import { installSkillFiles } from './agent-skill-install'
import {
  type LegacySkill,
  migrateSkillReferences,
  migrateStoredSkills,
  separateBuiltinSkills
} from './agent-skill-migration'
import { AGENT_SKILLS } from './agent-skills'
import { openAiSecret, sealAiSecret } from './ai-secrets'
import { getDatabaseConnection } from './database'

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
  groupId: provider.groupId,
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
  private readonly listeners = new Set<() => void>()
  private readonly skillFiles = new AgentSkillFiles(
    join(app.getPath('userData'), 'skills'),
    app.isPackaged
      ? join(process.resourcesPath, 'skills')
      : process.env.VIDBEE_E2E === '1' && process.env.VIDBEE_TEST_SKILLS_ROOT
        ? process.env.VIDBEE_TEST_SKILLS_ROOT
        : resolve(process.cwd(), '../../skills')
  )
  // biome-ignore lint/suspicious/noExplicitAny: electron-store is a CJS default export
  private readonly store: any

  constructor() {
    this.store = new Store({
      name: 'ai',
      defaults: {
        activeProviderId: null,
        providers: [],
        prompts: []
      } satisfies StoredAiState
    })
    this.ensurePrompts()
    this.store.onDidAnyChange(() => {
      this.notifySettingsChanged()
    })
    try {
      const stopWatching = this.skillFiles.watch(
        () => this.notifySettingsChanged(),
        (error) => log.warn('Failed to watch the skill library:', error)
      )
      app.once('will-quit', stopWatching)
    } catch (error) {
      log.warn('Failed to watch the skill library:', error)
    }
  }

  /** Refresh all settings consumers for both saved preferences and external skill edits. */
  private notifySettingsChanged(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('ai:settings-changed')
      }
    }
    for (const listener of this.listeners) {
      listener()
    }
  }

  /** Observe settings revisions without exposing credentials to any transport. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Persist preferences and identity while source files remain the only instruction authority. */
  private savePrompts(prompts: AiPrompt[]): void {
    this.store.set(
      'prompts',
      prompts.map((prompt) => ({
        name: prompt.name,
        directoryName: prompt.directoryName,
        isPreset: prompt.isPreset,
        userCreated: prompt.userCreated,
        autoRun: prompt.autoRun,
        showInTranscript: prompt.showInTranscript,
        workflowOnly: prompt.workflowOnly,
        sortOrder: prompt.sortOrder,
        createdAt: prompt.createdAt,
        updatedAt: prompt.updatedAt,
        content: ''
      }))
    )
  }

  /**
   * Re-insert missing built-in prompts and drop retired fields and preset ids.
   */
  private ensurePrompts(): void {
    const legacy = this.store.get('prompts') as LegacySkill[]
    const { skills: stored, renamed } = migrateStoredSkills(legacy, this.skillFiles)
    if (renamed.size) {
      migrateSkillReferences(getDatabaseConnection().sqlite, renamed)
    }
    const separated = separateBuiltinSkills(stored, this.skillFiles)
    if (separated.renamed.size) {
      migrateSkillReferences(getDatabaseConnection().sqlite, separated.renamed)
    }
    const merged = [...mergeDefaultAiPrompts(separated.skills)]
    for (const skill of [
      AGENT_SKILLS.articleRewrite,
      AGENT_SKILLS.faq,
      AGENT_SKILLS.videoLocalization,
      AGENT_SKILLS.diagnoseTask
    ]) {
      if (!merged.some((prompt) => prompt.name === skill.name)) {
        const prompt: AiPrompt = {
          name: skill.name,
          description: skill.description,
          content: skill.body,
          workflowOnly: true,
          isPreset: true,
          autoRun: false,
          sortOrder: merged.length,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
        merged.push(prompt)
      }
    }
    const migrated = this.synchronizePrompts(merged)
    this.savePrompts(migrated)
  }

  /** Persist external name and folder changes and migrate conversation references once. */
  private synchronizePrompts(prompts: AiPrompt[]): AiPrompt[] {
    const { skills, renamed } = this.skillFiles.synchronize(prompts)
    if (renamed.size) {
      migrateSkillReferences(getDatabaseConnection().sqlite, renamed)
    }
    if (
      skills.length !== prompts.length ||
      skills.some(
        (skill, index) =>
          skill.name !== prompts[index]?.name ||
          skill.directoryName !== prompts[index]?.directoryName
      )
    ) {
      this.savePrompts(skills)
    }
    return skills
  }

  /**
   * Read the full AI settings document.
   */
  private readState(): StoredAiState {
    const now = Date.now()
    const providers = Array.isArray(this.store.get('providers'))
      ? (this.store.get('providers') as StoredProvider[])
      : []
    const stored = Array.isArray(this.store.get('prompts'))
      ? (this.store.get('prompts') as AiPrompt[])
      : createDefaultAiPrompts(now)
    const prompts = this.synchronizePrompts(stored)
    const activeProviderId = this.store.get('activeProviderId')
    return {
      activeProviderId: typeof activeProviderId === 'string' ? activeProviderId : null,
      providers,
      prompts
    }
  }

  /** Read the managed model selected for future requests. */
  getCloudModelId(): string | null {
    const id: unknown = this.store.get('cloudModelId')
    return typeof id === 'string' && id ? id : null
  }

  /** Select a managed model and switch away from an own-key provider. */
  setCloudModel(id: string): AiSettingsSnapshot {
    if (typeof id !== 'string' || !id.trim() || id.length > 200) {
      throw new Error('Invalid Cloud model id')
    }
    this.store.set({ cloudModelId: id, activeProviderId: null })
    return this.getSnapshot()
  }

  /** Return safe provider settings and the persisted managed model selection. */
  getSnapshot(): AiSettingsSnapshot {
    const state = this.readState()
    const activeExists = state.providers.some((provider) => provider.id === state.activeProviderId)
    return {
      activeProviderId: activeExists ? state.activeProviderId : null,
      cloudModelId: this.getCloudModelId(),
      providers: state.providers.map(toPublicProvider),
      prompts: this.skillFiles
        .installed(state.prompts)
        .sort((left, right) => left.sortOrder - right.sortOrder)
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
      groupId: input.groupId ?? existing?.groupId,
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
    const content = input.content.trim()
    if (!content) {
      throw new Error('Skill instructions are required')
    }
    const state = this.readState()
    const now = Date.now()
    let name = input.name
    const existing = state.prompts.find((prompt) => prompt.name === (input.previousName ?? name))
    if (input.previousName && !existing) {
      throw new Error('Unknown skill')
    }
    if (existing?.isPreset && name === existing.name) {
      name = this.skillFiles.availableName(
        name,
        state.prompts.map((prompt) => prompt.name)
      )
    }
    if (
      this.skillFiles.isBuiltin(name) ||
      state.prompts.some((prompt) => prompt.name === name && prompt !== existing)
    ) {
      throw new Error('A skill with this name already exists')
    }
    const nextSort = state.prompts.reduce((max, prompt) => Math.max(max, prompt.sortOrder), -1) + 1
    const record: AiPrompt = {
      name,
      directoryName:
        existing && !existing.isPreset && name === existing.name
          ? existing.directoryName
          : undefined,
      description:
        input.description?.trim() ?? existing?.description ?? `Use when the user requests ${name}.`,
      workflowOnly: existing?.isPreset ? undefined : existing?.workflowOnly,
      content,
      autoRun: input.autoRun ?? (existing?.isPreset ? false : existing?.autoRun) ?? false,
      showInTranscript:
        input.showInTranscript ?? (existing?.isPreset ? true : existing?.showInTranscript),
      isPreset: false,
      userCreated: true,
      sortOrder: existing?.isPreset ? nextSort : (existing?.sortOrder ?? nextSort),
      createdAt: existing?.isPreset ? now : (existing?.createdAt ?? now),
      updatedAt: now
    }
    if (existing?.isPreset) {
      formatAgentSkillDocument({
        name,
        description: record.description ?? name,
        body: content,
        frontmatter: input.frontmatter
      })
      this.skillFiles.copy(existing, name)
    }
    this.skillFiles.write(
      record,
      existing?.isPreset ? undefined : (existing?.directoryName ?? existing?.name),
      input.frontmatter
    )
    if (existing && !existing.isPreset && existing.name !== name) {
      migrateSkillReferences(getDatabaseConnection().sqlite, new Map([[existing.name, name]]))
    }
    const prompts =
      existing && !existing.isPreset
        ? state.prompts.map((prompt) => (prompt.name === existing.name ? record : prompt))
        : [...state.prompts, record]
    this.savePrompts(prompts)
    return record
  }

  /**
   * Remove a personal skill; official skills remain read-only.
   *
   * @param id Prompt id.
   */
  deletePrompt(name: string): AiSettingsSnapshot {
    const state = this.readState()
    const prompt = state.prompts.find((item) => item.name === name)
    if (prompt) {
      this.skillFiles.remove(prompt.name, prompt.directoryName)
    }
    this.savePrompts(state.prompts.filter((prompt) => prompt.name !== name))
    return this.getSnapshot()
  }

  /**
   * Look up a prompt by name.
   *
   * @param name Standard skill name.
   */
  getPrompt(name: string): AiPrompt | undefined {
    return this.readState().prompts.find((prompt) => prompt.name === name)
  }

  /** Toggle transcript auto-run without changing manual skill availability or instructions. */
  setSkillAutoRun(name: string, autoRun: boolean): AiSettingsSnapshot {
    const state = this.readState()
    const skill = state.prompts.find((prompt) => prompt.name === name)
    if (!skill || typeof autoRun !== 'boolean') {
      throw new Error('Unknown skill or invalid transcript auto-run preference')
    }
    this.savePrompts(
      state.prompts.map((prompt) =>
        prompt.name === name ? { ...prompt, autoRun, updatedAt: Date.now() } : prompt
      )
    )
    return this.getSnapshot()
  }

  /** Save only the transcript sidebar shortcut preference without modifying the skill file. */
  setSkillTranscriptVisibility(name: string, showInTranscript: boolean): AiSettingsSnapshot {
    const state = this.readState()
    if (
      !state.prompts.some((prompt) => prompt.name === name) ||
      typeof showInTranscript !== 'boolean'
    ) {
      throw new Error('Unknown skill or invalid transcript visibility preference')
    }
    this.savePrompts(
      state.prompts.map((prompt) =>
        prompt.name === name ? { ...prompt, showInTranscript, updatedAt: Date.now() } : prompt
      )
    )
    return this.getSnapshot()
  }

  /** Install and discover a complete skill without replacing registered names or resources. */
  installSkill(files: Parameters<typeof installSkillFiles>[1]): AiPrompt {
    const document = files.find((file) => file.path === 'SKILL.md')
    const skill = parseAgentSkill(document?.data.toString('utf8') ?? '')
    const state = this.readState()
    if (state.prompts.some((prompt) => prompt.name === skill.name)) {
      throw new Error('A skill with this name already exists')
    }
    installSkillFiles(this.skillFiles, files)
    const installed = this.readState().prompts.find((prompt) => prompt.name === skill.name)
    if (!installed) {
      throw new Error('The installed skill could not be registered')
    }
    return installed
  }

  /** Resolve a registered skill folder without accepting renderer-supplied paths. */
  getSkillDirectory(name?: string): string {
    if (!name) {
      return this.skillFiles.root
    }
    const prompt = this.getPrompt(name)
    if (!prompt) {
      throw new Error('Unknown skill')
    }
    return this.skillFiles.sourceDirectory(prompt)
  }

  /** Export the actual file independently of invocation enablement. */
  exportSkillDocument(name: string): string {
    const prompt = this.getPrompt(name)
    if (!prompt) {
      throw new Error('Unknown skill')
    }
    return this.skillFiles.readSource(prompt)
  }

  /**
   * Re-add any missing built-in prompts.
   */
  restoreDefaultPrompts(): AiSettingsSnapshot {
    this.ensurePrompts()
    return this.getSnapshot()
  }
}

export const aiStore = new AiStore()
