import type { AiProviderPresetId } from '@shared/ai-types'

/** Brand mark used in the Composer model menu. */
export type AiModelIconId =
  | 'vidbee'
  | 'zhipu'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'gemini'
  | 'deepseek'
  | 'qwen'
  | 'xai'
  | 'meta'
  | 'kimi'
  | 'mistral'
  | 'minimax'
  | 'doubao'
  | 'stepfun'
  | 'hunyuan'
  | 'baichuan'
  | 'yi'
  | 'cohere'
  | 'nova'
  | 'microsoft'
  | 'perplexity'
  | 'spark'
  | 'wenxin'
  | 'groq'
  | 'ollama'
  | 'openrouter'
  | 'azure'
  | 'fireworks'
  | 'together'
  | 'huggingface'
  | 'lmstudio'
  | 'novita'
  | 'ppio'
  | 'siliconflow'
  | 'generic'

const PRESET_ICON_ID: Partial<Record<AiProviderPresetId, AiModelIconId>> = {
  alibaba: 'qwen',
  anthropic: 'anthropic',
  azure: 'azure',
  deepseek: 'deepseek',
  fireworks: 'fireworks',
  google: 'google',
  groq: 'groq',
  huggingface: 'huggingface',
  lmstudio: 'lmstudio',
  minimax: 'minimax',
  mistral: 'mistral',
  moonshot: 'kimi',
  novita: 'novita',
  ollama: 'ollama',
  openai: 'openai',
  openrouter: 'openrouter',
  ppio: 'ppio',
  siliconflow: 'siliconflow',
  stepfun: 'stepfun',
  together: 'together',
  volcengine: 'doubao',
  xai: 'xai',
  zhipu: 'zhipu'
}

/** Longer, more specific families first so `gpt` does not steal `chatgpt`-unrelated ids. */
const MODEL_PATTERNS: Array<{ id: AiModelIconId; pattern: RegExp }> = [
  { id: 'zhipu', pattern: /\b(glm|chatglm|glmv|zhipu|zai|z ai)\b/ },
  { id: 'anthropic', pattern: /\b(claude|anthropic|sonnet|haiku|opus)\b/ },
  { id: 'gemini', pattern: /\b(gemini|gemma)\b/ },
  { id: 'deepseek', pattern: /\bdeepseek\b/ },
  { id: 'qwen', pattern: /\b(qwen|qwq)\b/ },
  { id: 'xai', pattern: /\b(grok|xai)\b/ },
  { id: 'kimi', pattern: /\b(kimi|moonshot)\b/ },
  { id: 'mistral', pattern: /\b(mistral|mixtral|pixtral|magistral)\b/ },
  { id: 'minimax', pattern: /\b(minimax|abab)\b/ },
  { id: 'doubao', pattern: /\bdoubao\b/ },
  { id: 'stepfun', pattern: /\b(stepfun|step \d|step\d)\b/ },
  { id: 'hunyuan', pattern: /\bhunyuan\b/ },
  { id: 'baichuan', pattern: /\bbaichuan\b/ },
  { id: 'yi', pattern: /\b(yi|01ai)\b/ },
  { id: 'cohere', pattern: /\b(cohere|command r|command a)\b/ },
  { id: 'nova', pattern: /\bnova\b/ },
  { id: 'microsoft', pattern: /\bphi\b/ },
  { id: 'perplexity', pattern: /\b(perplexity|sonar)\b/ },
  { id: 'spark', pattern: /\b(spark|xinghuo)\b/ },
  { id: 'wenxin', pattern: /\b(wenxin|ernie)\b/ },
  { id: 'meta', pattern: /\b(llama|meta llama)\b/ },
  { id: 'openai', pattern: /\b(gpt|chatgpt|o1|o3|o4|davinci)\b/ },
  { id: 'google', pattern: /\bgoogle\b/ }
]

/**
 * Collapse provider prefixes and punctuation so `Z-AI/GLM-5.3-Flash` matches `glm`.
 *
 * @param text Model id or display name.
 */
function normalizeModelText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[/_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Pick a LobeHub brand from the model id first, then the provider preset.
 *
 * @param input.isCloud VidBee Cloud, which always uses the VidBee mark.
 * @param input.presetId Saved provider catalog id.
 * @param input.modelId Provider model id, e.g. `Z-AI/GLM-5.3-Flash`.
 * @param input.name User-facing provider or model name.
 */
export function resolveAiModelIconId(input: {
  isCloud?: boolean
  presetId?: AiProviderPresetId | null
  modelId?: string
  name?: string
}): AiModelIconId {
  if (input.isCloud) {
    return 'vidbee'
  }
  const haystack = normalizeModelText([input.modelId, input.name].filter(Boolean).join(' '))
  if (haystack) {
    const match = MODEL_PATTERNS.find((entry) => entry.pattern.test(haystack))
    if (match) {
      return match.id
    }
  }
  if (input.presetId) {
    return PRESET_ICON_ID[input.presetId] ?? 'generic'
  }
  return 'generic'
}
