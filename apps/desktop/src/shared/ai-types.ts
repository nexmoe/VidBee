import type { AgentThinkingLevel, ProviderDefaultThinkingLevel } from './agent-chat'

/** Built-in LLM provider ids shown on the settings catalog. */
export type AiProviderPresetId =
  | 'alibaba'
  | 'anthropic'
  | 'azure'
  | 'custom'
  | 'deepseek'
  | 'fireworks'
  | 'google'
  | 'groq'
  | 'huggingface'
  | 'lmstudio'
  | 'minimax'
  | 'mistral'
  | 'moonshot'
  | 'novita'
  | 'ollama'
  | 'openai'
  | 'openrouter'
  | 'ppio'
  | 'siliconflow'
  | 'stepfun'
  | 'together'
  | 'volcengine'
  | 'xai'
  | 'zhipu'

/** Lucide icon names stored with a prompt. */
export type AiPromptIconId =
  | 'list'
  | 'spell-check'
  | 'rows-3'
  | 'highlighter'
  | 'circle-help'
  | 'smile'
  | 'message-circle-question'
  | 'chart-no-axes-column'
  | 'repeat-2'
  | 'git-branch'
  | 'languages'
  | 'sparkles'

/** Catalog entry for a built-in provider. */
export interface AiProviderPreset {
  id: AiProviderPresetId
  defaultModel: string
  needsApiKey: boolean
  requiresBaseUrl: boolean
  baseUrl?: string
  /** Public site shown on the catalog card, not the API host. */
  website?: string
}

/** Persisted provider configuration. The API key never leaves the main process. */
export interface AiProviderConfig {
  contextWindow?: number
  vision?: boolean
  /** When false, Agent chat does not send tools to this model. */
  tools?: boolean
  /** When false, the model does not expose thinking controls. */
  reasoning?: boolean
  /** When true, the composer shows only a thinking on/off switch. */
  thinkingOnly?: boolean
  /** When false, thinking cannot be turned off. */
  allowDisableThinking?: boolean
  /** Effort levels this model accepts. Empty or omitted keeps catalog defaults. */
  thinkingLevels?: AgentThinkingLevel[]
  /** Composer default. `auto` follows the request-layer default. */
  defaultThinkingLevel?: ProviderDefaultThinkingLevel
  /** Optional output cap. Omitted uses the provider or catalog default. */
  maxTokens?: number
  id: string
  presetId: AiProviderPresetId
  name: string
  baseUrl: string
  modelId: string
  hasApiKey: boolean
  createdAt: number
  updatedAt: number
}

/** Payload used to create or update a provider from the renderer. */
export interface AiProviderWriteInput {
  contextWindow?: number
  vision?: boolean
  tools?: boolean
  reasoning?: boolean
  thinkingOnly?: boolean
  allowDisableThinking?: boolean
  thinkingLevels?: AgentThinkingLevel[]
  defaultThinkingLevel?: ProviderDefaultThinkingLevel
  maxTokens?: number
  id?: string
  presetId: AiProviderPresetId
  name?: string
  baseUrl?: string
  modelId: string
  apiKey?: string
  /** When creating another model on the same endpoint, reuse this provider's saved key. */
  copyApiKeyFromId?: string
}

/** User-editable prompt used with a transcript. */
export interface AiPrompt {
  id: string
  title: string
  icon: AiPromptIconId
  content: string
  enabled: boolean
  isPreset: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
}

/** Payload used to create or update a prompt from the renderer. */
export interface AiPromptWriteInput {
  id?: string
  title: string
  icon: AiPromptIconId
  content: string
  enabled?: boolean
}

/** Lifecycle of a prompt run that lives in the main process. */
export type AiPromptRunStatus = 'idle' | 'running' | 'completed' | 'aborted' | 'error'

/** Why a prompt run failed, used to pick setup guidance in the UI. */
export type AiPromptErrorCode =
  | 'sign-in-required'
  | 'credits-exhausted'
  | 'no-provider'
  | 'missing-api-key'
  | 'missing-model'
  | 'unknown-prompt'
  | 'empty-transcript'
  | 'auth'
  | 'network'
  | 'empty-output'
  | 'unknown'

/** Result of a one-shot ping that checks whether a provider can run. */
export interface AiProviderTestResult {
  ok: boolean
  text: string
  error: string | null
  errorCode: AiPromptErrorCode | null
}

/** Snapshot a renderer can restore after navigating away. */
export interface AiPromptRunSnapshot {
  cloudResultId?: string
  /** Latest transient failure, visible until fresh model output arrives. */
  recovery?: { attempt: number; maxAttempts: number; error: string }
  downloadId: string
  promptId: string
  status: AiPromptRunStatus
  text: string
  /** Model reasoning, shown in ThinkingSteps instead of Streamdown. */
  thinking: string
  /** Milliseconds spent reasoning, so the header keeps its duration on reload. */
  thinkingMs: number
  error: string | null
  errorCode: AiPromptErrorCode | null
  updatedAt: number
}

/** Input required to start a prompt run. */
export interface AiPromptRunInput {
  forceRegenerate?: boolean
  downloadId: string
  promptId: string
  transcriptText: string
  /** UI language tag; built-in translate prompts resolve {{uiLanguage}} from this. */
  uiLanguage?: string
  /** Public video URL used as the Cloud cache identity. */
  sourceUrl?: string
  /** ISO 639 / BCP-47 language of the captions being sent. */
  transcriptLanguage?: string
  /** Whether these captions came from ASR / platform-auto or a human track. */
  transcriptOrigin?: 'ai' | 'human'
}

/** Providers and prompts returned together for settings pages. */
export interface CloudModelOption {
  id: string
  name: string
  multiplier: number
}

export interface AiSettingsSnapshot {
  cloudModelId?: string | null
  activeProviderId: string | null
  providers: AiProviderConfig[]
  prompts: AiPrompt[]
}
