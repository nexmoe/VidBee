import type { AiProviderPreset, AiProviderPresetId } from './ai-types'

/**
 * Built-in OpenAI-compatible providers. Preset base URLs stay in the catalog so
 * the settings dialog can hide the field unless the user picks Custom.
 */
export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    id: 'custom',
    defaultModel: '',
    needsApiKey: true,
    requiresBaseUrl: true
  },
  {
    id: 'alibaba',
    defaultModel: 'qwen-plus',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    website: 'dashscope.console.aliyun.com'
  },
  {
    id: 'anthropic',
    defaultModel: 'claude-sonnet-4-5',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://api.anthropic.com',
    website: 'anthropic.com'
  },
  {
    id: 'azure',
    defaultModel: 'gpt-4o-mini',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://api.openai.com/v1',
    website: 'azure.microsoft.com'
  },
  {
    id: 'deepseek',
    defaultModel: 'deepseek-chat',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://api.deepseek.com',
    website: 'platform.deepseek.com'
  },
  {
    id: 'fireworks',
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    website: 'fireworks.ai'
  },
  {
    id: 'google',
    defaultModel: 'gemini-2.5-flash',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://generativelanguage.googleapis.com',
    website: 'aistudio.google.com'
  },
  {
    id: 'groq',
    defaultModel: 'llama-3.3-70b-versatile',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://api.groq.com/openai/v1',
    website: 'console.groq.com'
  },
  {
    id: 'huggingface',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://router.huggingface.co/v1',
    website: 'huggingface.co'
  },
  {
    id: 'lmstudio',
    defaultModel: '',
    needsApiKey: false,
    requiresBaseUrl: false,
    baseUrl: 'http://127.0.0.1:1234/v1',
    website: 'lmstudio.ai'
  },
  {
    id: 'minimax',
    defaultModel: 'MiniMax-M1',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://api.minimax.chat/v1',
    website: 'platform.minimax.io'
  },
  {
    id: 'mistral',
    defaultModel: 'mistral-small-latest',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://api.mistral.ai/v1',
    website: 'console.mistral.ai'
  },
  {
    id: 'moonshot',
    defaultModel: 'kimi-k2.5',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://api.moonshot.cn/v1',
    website: 'platform.moonshot.cn'
  },
  {
    id: 'novita',
    defaultModel: 'deepseek/deepseek-v3-0324',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://api.novita.ai/v3/openai',
    website: 'novita.ai'
  },
  {
    id: 'ollama',
    defaultModel: 'llama3.1',
    needsApiKey: false,
    requiresBaseUrl: false,
    baseUrl: 'http://127.0.0.1:11434/v1',
    website: 'ollama.com'
  },
  {
    id: 'openai',
    defaultModel: 'gpt-4o-mini',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://api.openai.com/v1',
    website: 'platform.openai.com'
  },
  {
    id: 'openrouter',
    defaultModel: 'openai/gpt-4o-mini',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://openrouter.ai/api/v1',
    website: 'openrouter.ai'
  },
  {
    id: 'ppio',
    defaultModel: 'deepseek/deepseek-v3-turbo',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://api.ppio.com/openai',
    website: 'ppio.com'
  },
  {
    id: 'siliconflow',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://api.siliconflow.cn/v1',
    website: 'siliconflow.cn'
  },
  {
    id: 'stepfun',
    defaultModel: 'step-2-mini',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://api.stepfun.com/v1',
    website: 'platform.stepfun.com'
  },
  {
    id: 'together',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://api.together.xyz/v1',
    website: 'together.ai'
  },
  {
    id: 'volcengine',
    defaultModel: 'doubao-1.5-pro-32k',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    website: 'console.volcengine.com'
  },
  {
    id: 'xai',
    defaultModel: 'grok-4.5',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://api.x.ai/v1',
    website: 'x.ai'
  },
  {
    id: 'zhipu',
    defaultModel: 'glm-4.5-flash',
    needsApiKey: true,
    requiresBaseUrl: false,
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    website: 'open.bigmodel.cn'
  }
] as const

const PRESET_BY_ID = new Map(AI_PROVIDER_PRESETS.map((preset) => [preset.id, preset]))

/**
 * Look up a built-in provider by id.
 *
 * @param id Preset id from settings or storage.
 * @returns The catalog entry, or undefined when the id is unknown.
 */
export const getAiProviderPreset = (id: string): AiProviderPreset | undefined =>
  PRESET_BY_ID.get(id as AiProviderPresetId)

/**
 * Resolve the base URL a provider should use.
 *
 * Custom (and any preset that requires it) uses the user value. Other presets
 * always use the catalog URL so the dialog can omit the field.
 *
 * @param presetId Built-in provider id.
 * @param userBaseUrl Optional URL typed in the dialog.
 */
export const resolveAiProviderBaseUrl = (
  presetId: AiProviderPresetId,
  userBaseUrl?: string
): string => {
  const preset = getAiProviderPreset(presetId)
  if (preset?.requiresBaseUrl) {
    return userBaseUrl?.trim() ?? ''
  }
  return preset?.baseUrl ?? userBaseUrl?.trim() ?? ''
}

/**
 * True when the dialog should ask for a base URL.
 *
 * @param presetId Built-in provider id.
 */
export const aiProviderRequiresBaseUrl = (presetId: AiProviderPresetId): boolean =>
  getAiProviderPreset(presetId)?.requiresBaseUrl === true

/**
 * True when the provider needs an API key to run.
 *
 * @param presetId Built-in provider id.
 */
export const aiProviderNeedsApiKey = (presetId: AiProviderPresetId): boolean =>
  getAiProviderPreset(presetId)?.needsApiKey !== false
