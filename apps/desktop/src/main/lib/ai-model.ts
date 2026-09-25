import { getSupportedThinkingLevels, type ThinkingLevelMap } from '@earendil-works/pi-ai'
import {
  type Api,
  getModel,
  getModels,
  getProviders,
  type Model
} from '@earendil-works/pi-ai/compat'
import {
  type AgentThinkingLevel,
  type AgentThinkingOptions,
  PROVIDER_THINKING_EFFORT_LEVELS,
  type ProviderDefaultThinkingLevel
} from '../../shared/agent-chat'
import { getAiProviderPreset, resolveAiProviderBaseUrl } from '../../shared/ai-presets'
import type { AiProviderPresetId } from '../../shared/ai-types'

type PiKnownProvider =
  | 'anthropic'
  | 'azure-openai-responses'
  | 'deepseek'
  | 'google'
  | 'groq'
  | 'huggingface'
  | 'openai'
  | 'openrouter'
  | 'xai'
  | 'zai'

const PI_PROVIDER_BY_PRESET: Partial<Record<AiProviderPresetId, PiKnownProvider>> = {
  anthropic: 'anthropic',
  azure: 'azure-openai-responses',
  deepseek: 'deepseek',
  google: 'google',
  groq: 'groq',
  huggingface: 'huggingface',
  openai: 'openai',
  openrouter: 'openrouter',
  xai: 'xai',
  zhipu: 'zai'
}

const OPENAI_COMPLETIONS_PRESETS = new Set<AiProviderPresetId>([
  'alibaba',
  'custom',
  'deepseek',
  'fireworks',
  'groq',
  'huggingface',
  'lmstudio',
  'minimax',
  'mistral',
  'moonshot',
  'novita',
  'ollama',
  'openai',
  'openrouter',
  'ppio',
  'siliconflow',
  'stepfun',
  'together',
  'volcengine',
  'xai',
  'zhipu'
])

/**
 * Build a fallback OpenAI-compatible model when the catalog has no match.
 *
 * Custom endpoints are assumed to accept thinking controls. Catalog matches
 * can turn reasoning off. Unknown proxies reject the `developer` role.
 *
 * @param modelId User-entered model id.
 * @param baseUrl Provider endpoint.
 */
const createOpenAiCompatibleModel = (
  modelId: string,
  baseUrl: string
): Model<'openai-completions'> =>
  ({
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: 'unknown',
    baseUrl,
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    // 0 omits max_tokens so the provider chooses its own output limit.
    maxTokens: 0,
    compat: { supportsDeveloperRole: false }
  }) as Model<'openai-completions'>

/**
 * Build the OpenAI-compatible model pi-agent uses for VidBee Cloud.
 *
 * @param apiBaseUrl Desktop auth API origin, such as https://api.vidbee.org.
 */
export const createVidbeeCloudModel = (apiBaseUrl: string): Model<'openai-completions'> => ({
  ...createOpenAiCompatibleModel('vidbee-cloud', `${apiBaseUrl.replace(/\/$/u, '')}/api/ai`),
  name: 'VidBee Cloud',
  // Cloud is an opaque proxy; generation uses provider defaults, not placeholder model limits.
  contextWindow: 0,
  maxTokens: 0,
  reasoning: true,
  // Cloud applies the selected model's default when a prompt has no explicit thinking choice.
  thinkingLevelMap: { off: null },
  compat: { supportsDeveloperRole: false }
})

/**
 * Resolve a pi-ai model for a configured provider.
 *
 * Known presets try the catalog first so Anthropic/Google keep their native
 * APIs. Anything else, including custom endpoints, uses OpenAI completions.
 *
 * @param input Provider preset, model id, and optional custom base URL.
 */
const resolveCatalogPiModel = (input: {
  presetId: AiProviderPresetId
  modelId: string
  baseUrl?: string
}): Model<Api> => {
  const modelId = input.modelId.trim()
  const baseUrl = resolveAiProviderBaseUrl(input.presetId, input.baseUrl)
  const piProvider = PI_PROVIDER_BY_PRESET[input.presetId]
  if (piProvider && modelId) {
    try {
      const catalogModel = getModel(piProvider as never, modelId as never) as Model<Api>
      if (baseUrl && OPENAI_COMPLETIONS_PRESETS.has(input.presetId)) {
        return { ...catalogModel, baseUrl }
      }
      return catalogModel
    } catch {
      // The user can type any model id; fall through to a compatible model.
    }
  }

  if (input.presetId === 'anthropic') {
    return {
      id: modelId,
      name: modelId,
      api: 'anthropic-messages',
      provider: 'anthropic',
      baseUrl: getAiProviderPreset('anthropic')?.baseUrl ?? 'https://api.anthropic.com',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 8192
    }
  }

  if (input.presetId === 'google') {
    return {
      id: modelId,
      name: modelId,
      api: 'google-generative-ai',
      provider: 'google',
      baseUrl:
        getAiProviderPreset('google')?.baseUrl ?? 'https://generativelanguage.googleapis.com',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 8192
    }
  }

  return applyCatalogThinking(
    createOpenAiCompatibleModel(modelId, baseUrl),
    findCatalogModel(input)
  )
}

/** One catalog row the provider dialog can pick or create. */
export interface CatalogModelOption {
  label: string
  value: string
}

/** Capabilities copied from the pi-ai catalog when the model id is known. */
export interface CatalogModelCapabilities {
  allowDisableThinking: boolean
  contextWindow: number
  id: string
  maxTokens?: number
  name: string
  reasoning: boolean
  thinkingLevels: AgentThinkingLevel[]
  thinkingOnly: boolean
  vision: boolean
}

/** Fields a saved provider can overlay onto a resolved pi-ai model. */
export interface ProviderModelCapabilities {
  allowDisableThinking?: boolean
  contextWindow?: number
  defaultThinkingLevel?: ProviderDefaultThinkingLevel
  maxTokens?: number
  reasoning?: boolean
  thinkingLevels?: AgentThinkingLevel[]
  thinkingOnly?: boolean
  vision?: boolean
}

/**
 * Compare catalog ids ignoring case, slashes, and punctuation.
 *
 * @param value Model id or display name.
 */
const normalizeCatalogId = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replaceAll(/[/:_]+/g, '-')
    .replaceAll(/[^a-z0-9.-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')

/**
 * Copy context window and vision from a catalog model.
 *
 * @param model pi-ai catalog entry.
 */
const capabilitiesFromCatalogModel = (
  model: Model<Api> | undefined
): CatalogModelCapabilities | null => {
  if (!model) {
    return null
  }
  if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 4096) {
    return null
  }
  const thinking = catalogThinkingCapabilities(model)
  return {
    allowDisableThinking: thinking.allowDisableThinking,
    contextWindow: model.contextWindow,
    id: model.id,
    maxTokens:
      Number.isSafeInteger(model.maxTokens) &&
      model.maxTokens >= 256 &&
      model.maxTokens < model.contextWindow
        ? model.maxTokens
        : undefined,
    name: model.name?.trim() || model.id,
    reasoning: thinking.reasoning,
    thinkingLevels: thinking.thinkingLevels,
    thinkingOnly: thinking.thinkingOnly,
    vision: Array.isArray(model.input) && model.input.includes('image')
  }
}

/**
 * Infer thinking switches from a catalog model.
 *
 * @param model pi-ai catalog entry.
 */
function catalogThinkingCapabilities(
  model: Model<Api>
): Pick<
  CatalogModelCapabilities,
  'allowDisableThinking' | 'reasoning' | 'thinkingLevels' | 'thinkingOnly'
> {
  if (!model.reasoning) {
    return {
      allowDisableThinking: true,
      reasoning: false,
      thinkingLevels: [],
      thinkingOnly: false
    }
  }
  const levels = getSupportedThinkingLevels(model)
  const thinkingLevels = levels.filter((level): level is AgentThinkingLevel =>
    (PROVIDER_THINKING_EFFORT_LEVELS as readonly string[]).includes(level)
  )
  return {
    allowDisableThinking: levels.includes('off'),
    reasoning: true,
    thinkingLevels,
    thinkingOnly: thinkingLevels.length <= 1
  }
}

/**
 * Read every generated pi-ai catalog model, ignoring providers that fail to load.
 */
const allCatalogModels = (): Model<Api>[] => {
  try {
    return getProviders().flatMap((provider) => {
      try {
        return getModels(provider as never) as Model<Api>[]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

/**
 * List catalog models for this preset only. Unmapped endpoints stay empty so
 * the picker does not dump every vendor; type-to-create and GET /models cover those.
 *
 * @param presetId Built-in provider id from the dialog.
 */
export function listCatalogModelOptions(presetId: AiProviderPresetId): CatalogModelOption[] {
  const mappedProvider = PI_PROVIDER_BY_PRESET[presetId]
  let models: Model<Api>[] = []
  if (mappedProvider) {
    try {
      models = getModels(mappedProvider as never) as Model<Api>[]
    } catch {
      models = []
    }
  }
  const seen = new Set<string>()
  const options: CatalogModelOption[] = []
  for (const model of models) {
    const value = model.id.trim()
    if (!value || seen.has(value)) {
      continue
    }
    seen.add(value)
    const name = model.name?.trim() || value
    options.push({ label: name === value ? value : `${name} (${value})`, value })
  }
  return options.sort((left, right) => left.label.localeCompare(right.label))
}

/**
 * Rank how closely a catalog entry matches the typed model id.
 *
 * @param model Catalog model.
 * @param needle Normalized user-entered id.
 */
const catalogMatchScore = (model: Model<Api>, needle: string): number => {
  const id = normalizeCatalogId(model.id)
  const name = normalizeCatalogId(model.name ?? '')
  if (id === needle) {
    return 100
  }
  if (name === needle) {
    return 90
  }
  if (needle.length >= 6 && (id.startsWith(`${needle}-`) || id.startsWith(`${needle}.`))) {
    return 80
  }
  return 0
}

/**
 * Find a pi-ai catalog model by preset mapping, then by id across every provider.
 *
 * Custom OpenAI-compatible endpoints still match DeepSeek/OpenAI ids so thinking
 * levels, context window, and vision can follow the catalog.
 *
 * @param input Provider preset and the user-entered model id.
 */
function findCatalogModel(input: {
  presetId: AiProviderPresetId
  modelId: string
}): Model<Api> | undefined {
  const modelId = input.modelId.trim()
  if (!modelId) {
    return undefined
  }
  const mappedProvider = PI_PROVIDER_BY_PRESET[input.presetId]
  if (mappedProvider) {
    try {
      const exact = getModel(mappedProvider as never, modelId as never) as Model<Api> | undefined
      if (exact) {
        return exact
      }
    } catch {
      // Unknown ids throw or return undefined; fall through to a catalog scan.
    }
  }
  const needle = normalizeCatalogId(modelId)
  if (!needle) {
    return undefined
  }
  let best: Model<Api> | undefined
  let bestScore = 0
  for (const model of allCatalogModels()) {
    const score = catalogMatchScore(model, needle)
    if (score > bestScore) {
      best = model
      bestScore = score
    }
  }
  return bestScore >= 80 ? best : undefined
}

/**
 * Copy catalog reasoning onto an OpenAI-compatible fallback.
 *
 * Native Anthropic/Google APIs stay on their own resolve path. Completions
 * catalog entries also keep thinkingFormat so DeepSeek-style models still
 * advertise the levels pi-ai already knows. Unknown proxies reject `developer`.
 *
 * @param model OpenAI-compatible fallback.
 * @param catalog Matching catalog model, if any.
 */
function applyCatalogThinking(
  model: Model<'openai-completions'>,
  catalog: Model<Api> | undefined
): Model<'openai-completions'> {
  if (!catalog) {
    return model
  }
  const completionsCompat =
    catalog.api === 'openai-completions'
      ? (catalog as Model<'openai-completions'>).compat
      : undefined
  return {
    ...model,
    reasoning: Boolean(catalog.reasoning),
    ...(catalog.thinkingLevelMap ? { thinkingLevelMap: catalog.thinkingLevelMap } : {}),
    compat: {
      ...model.compat,
      ...completionsCompat,
      supportsDeveloperRole: completionsCompat?.supportsDeveloperRole ?? false
    }
  }
}

/**
 * Look up a model in the pi-ai catalog without applying VidBee fallbacks.
 *
 * Custom endpoints still match by model id across the whole catalog, so a
 * DeepSeek id on an OpenAI-compatible proxy can fill context window and vision.
 *
 * @param input Provider preset and the user-entered model id.
 * @returns Catalog context window and vision when the id is known; otherwise null.
 */
export function lookupCatalogModelCapabilities(input: {
  presetId: AiProviderPresetId
  modelId: string
}): CatalogModelCapabilities | null {
  return capabilitiesFromCatalogModel(findCatalogModel(input))
}

/**
 * Overlay saved provider switches onto a resolved catalog or fallback model.
 *
 * An unset output cap stays 0 so the request omits max_tokens. Selected
 * thinking levels constrain the effort map; allowing thinking to be turned
 * off maps `off` to `none`.
 *
 * @param model Catalog or OpenAI-compatible fallback.
 * @param input Explicit provider capability switches.
 */
export function applyProviderCapabilities(
  model: Model<Api>,
  input: ProviderModelCapabilities
): Model<Api> {
  const contextWindow = input.contextWindow ?? model.contextWindow
  const maxTokens =
    input.maxTokens === undefined
      ? model.maxTokens > 0
        ? Math.min(model.maxTokens, Math.floor(contextWindow / 4) || model.maxTokens)
        : 0
      : Math.min(Math.max(input.maxTokens, 256), Math.max(256, contextWindow - 1))
  const next: Model<Api> = {
    ...model,
    contextWindow,
    maxTokens,
    input: input.vision === undefined ? model.input : input.vision ? ['text', 'image'] : ['text']
  }
  if (input.reasoning === false) {
    return { ...next, reasoning: false }
  }
  if (input.reasoning !== true && !next.reasoning) {
    return next
  }
  const map: ThinkingLevelMap = constrainThinkingLevelMap(
    { ...next.thinkingLevelMap },
    input.thinkingLevels
  )
  if (input.allowDisableThinking === false) {
    map.off = null
  } else if (input.allowDisableThinking === true && map.off === null) {
    map.off = 'none'
  }
  return {
    ...next,
    reasoning: true,
    thinkingLevelMap: Object.keys(map).length > 0 ? map : next.thinkingLevelMap
  }
}

/**
 * Keep only the effort levels the provider advertised.
 *
 * @param map Catalog or fallback thinking map.
 * @param thinkingLevels Selected effort levels. Omitted keeps catalog defaults.
 */
function constrainThinkingLevelMap(
  map: ThinkingLevelMap,
  thinkingLevels: AgentThinkingLevel[] | undefined
): ThinkingLevelMap {
  if (!thinkingLevels || thinkingLevels.length === 0) {
    return map
  }
  const allowed = new Set(thinkingLevels)
  map.minimal = null
  for (const level of PROVIDER_THINKING_EFFORT_LEVELS) {
    map[level] = allowed.has(level) ? (map[level] ?? level) : null
  }
  return map
}

/**
 * Composer thinking options for a resolved own-key model.
 *
 * Thinking-only keeps a switch; otherwise every supported effort level is shown.
 *
 * @param model Resolved pi-ai model.
 * @param provider Saved thinking switches.
 */
export function thinkingOptionsFromProvider(
  model: Model<Api>,
  provider: {
    defaultThinkingLevel?: ProviderDefaultThinkingLevel
    thinkingOnly?: boolean
  }
): AgentThinkingOptions {
  const supported = getSupportedThinkingLevels(model) as AgentThinkingLevel[]
  const vision = model.input.includes('image')
  const onLevels = supported.filter((level) => level !== 'off')
  if (provider.thinkingOnly) {
    const onLevel = pickThinkingOnLevel(provider.defaultThinkingLevel, onLevels)
    const levels: AgentThinkingLevel[] = supported.includes('off') ? ['off', onLevel] : [onLevel]
    return {
      levels,
      defaultLevel: resolveConfiguredThinkingLevel(provider.defaultThinkingLevel, levels),
      vision
    }
  }
  return {
    levels: supported,
    defaultLevel: resolveConfiguredThinkingLevel(provider.defaultThinkingLevel, supported),
    vision
  }
}

/**
 * Pick the on-state used when the composer only shows a thinking switch.
 *
 * @param configured Saved default, or auto.
 * @param onLevels Effort levels the model accepts.
 */
function pickThinkingOnLevel(
  configured: ProviderDefaultThinkingLevel | undefined,
  onLevels: AgentThinkingLevel[]
): AgentThinkingLevel {
  if (configured && configured !== 'auto' && onLevels.includes(configured)) {
    return configured
  }
  if (onLevels.includes('medium')) {
    return 'medium'
  }
  return onLevels[0] ?? 'medium'
}

/**
 * Resolve the composer default from a saved value.
 *
 * Auto (or an unsupported level) uses off when available, otherwise the first level.
 *
 * @param configured Saved default, or auto.
 * @param levels Levels shown in the composer.
 */
function resolveConfiguredThinkingLevel(
  configured: ProviderDefaultThinkingLevel | undefined,
  levels: AgentThinkingLevel[]
): AgentThinkingLevel {
  if (configured && configured !== 'auto' && levels.includes(configured)) {
    return configured
  }
  return levels.includes('off') ? 'off' : (levels[0] ?? 'off')
}

/** Apply explicit model capabilities while leaving catalog defaults intact. */
export const resolvePiModel = (input: {
  presetId: AiProviderPresetId
  modelId: string
  baseUrl?: string
  contextWindow?: number
  maxTokens?: number
  vision?: boolean
  reasoning?: boolean
  thinkingOnly?: boolean
  thinkingLevels?: AgentThinkingLevel[]
  allowDisableThinking?: boolean
}): Model<Api> => applyProviderCapabilities(resolveCatalogPiModel(input), input)
