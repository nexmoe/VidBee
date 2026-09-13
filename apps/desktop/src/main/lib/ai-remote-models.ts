import { aiProviderNeedsApiKey, resolveAiProviderBaseUrl } from '../../shared/ai-presets'
import type { AiProviderPresetId } from '../../shared/ai-types'
import { scopedLoggers } from '../utils/logger'
import type { CatalogModelOption } from './ai-model'
import { aiStore } from './ai-store'

const log = scopedLoggers.ai
const REMOTE_MODELS_TIMEOUT_MS = 15_000

export interface AiRemoteModelsInput {
  apiKey?: string
  baseUrl?: string
  id?: string
  presetId: AiProviderPresetId
}

export interface ListRemoteModelsDeps {
  fetch: typeof fetch
  resolveApiKey: (input: AiRemoteModelsInput) => string
}

/**
 * Use the typed key, or the stored key when editing and the field was left blank.
 *
 * @param input Dialog values.
 */
const defaultResolveApiKey = (input: AiRemoteModelsInput): string => {
  const typed = input.apiKey?.trim()
  if (typed) {
    return typed
  }
  return input.id ? aiStore.getProviderSecret(input.id) : ''
}

/**
 * Ask the provider for the models this key can use.
 *
 * OpenAI-compatible endpoints expose GET /models. Anthropic uses the same path
 * on /v1 with x-api-key. Failures return an empty list so the catalog remains.
 *
 * @param input Dialog credentials.
 * @param deps Optional fetch and key resolver for tests.
 */
export async function listRemoteProviderModels(
  input: AiRemoteModelsInput,
  deps: Partial<ListRemoteModelsDeps> = {}
): Promise<CatalogModelOption[]> {
  const fetchImpl = deps.fetch ?? fetch
  const resolveApiKey = deps.resolveApiKey ?? defaultResolveApiKey
  const baseUrl = resolveAiProviderBaseUrl(input.presetId, input.baseUrl)
  if (!baseUrl) {
    return []
  }
  const apiKey = resolveApiKey(input)
  if (aiProviderNeedsApiKey(input.presetId) && !apiKey) {
    return []
  }
  const url = modelsUrl(input.presetId, baseUrl)
  try {
    const response = await fetchImpl(url, {
      headers: remoteModelsHeaders(input.presetId, apiKey),
      signal: AbortSignal.timeout(REMOTE_MODELS_TIMEOUT_MS)
    })
    if (!response.ok) {
      log.warn('ai remote models failed', { presetId: input.presetId, status: response.status })
      return []
    }
    const options = parseRemoteModelOptions(await response.json())
    log.info('ai remote models loaded', { presetId: input.presetId, count: options.length })
    return options
  } catch (error) {
    log.warn('ai remote models failed', {
      presetId: input.presetId,
      error: error instanceof Error ? error.message : 'unknown'
    })
    return []
  }
}

/**
 * Build GET /models on the resolved provider host.
 *
 * @param presetId Built-in provider id.
 * @param baseUrl Resolved API root.
 */
function modelsUrl(presetId: AiProviderPresetId, baseUrl: string): string {
  const root = baseUrl.replace(/\/+$/u, '')
  if (presetId === 'anthropic' && !/\/v\d+$/u.test(root)) {
    return `${root}/v1/models`
  }
  return `${root}/models`
}

/**
 * Auth headers the provider's model list accepts.
 *
 * @param presetId Built-in provider id.
 * @param apiKey Decrypted or typed key.
 */
function remoteModelsHeaders(presetId: AiProviderPresetId, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (!apiKey) {
    return headers
  }
  if (presetId === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01'
    headers['x-api-key'] = apiKey
    return headers
  }
  headers.Authorization = `Bearer ${apiKey}`
  return headers
}

/**
 * Read model ids from an OpenAI, Anthropic, or Gemini-style list payload.
 *
 * @param payload JSON body from GET /models.
 */
export function parseRemoteModelOptions(payload: unknown): CatalogModelOption[] {
  const seen = new Set<string>()
  const options: CatalogModelOption[] = []
  for (const entry of remoteModelEntries(payload)) {
    const value = remoteModelId(entry)
    if (!value || seen.has(value)) {
      continue
    }
    seen.add(value)
    const label = remoteModelLabel(entry, value)
    options.push({ label, value })
  }
  return options.sort((left, right) => left.label.localeCompare(right.label))
}

/**
 * Walk the common list wrappers: a bare array, `{ data }`, or `{ models }`.
 *
 * @param payload JSON body from GET /models.
 */
function remoteModelEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload
  }
  if (!payload || typeof payload !== 'object') {
    return []
  }
  const record = payload as { data?: unknown; models?: unknown }
  if (Array.isArray(record.data)) {
    return record.data
  }
  if (Array.isArray(record.models)) {
    return record.models
  }
  return []
}

/**
 * Prefer `id`, then a Gemini `name` with the `models/` prefix stripped.
 *
 * @param entry One model object or a bare id string.
 */
function remoteModelId(entry: unknown): string {
  if (typeof entry === 'string') {
    return normalizeRemoteModelId(entry)
  }
  if (!entry || typeof entry !== 'object') {
    return ''
  }
  const record = entry as { id?: unknown; name?: unknown }
  if (typeof record.id === 'string') {
    return normalizeRemoteModelId(record.id)
  }
  if (typeof record.name === 'string') {
    return normalizeRemoteModelId(record.name)
  }
  return ''
}

/**
 * Visible label: display name plus id when they differ.
 *
 * @param entry One model object or a bare id string.
 * @param value Canonical model id.
 */
function remoteModelLabel(entry: unknown, value: string): string {
  if (!entry || typeof entry !== 'object') {
    return value
  }
  const record = entry as { display_name?: unknown; displayName?: unknown; name?: unknown }
  const name = [record.display_name, record.displayName, record.name].find(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  )
  if (!name) {
    return value
  }
  const trimmed = name.replace(/^models\//u, '').trim()
  return !trimmed || trimmed === value ? value : `${trimmed} (${value})`
}

/**
 * Strip Gemini `models/` prefixes and surrounding whitespace.
 *
 * @param value Raw id or resource name.
 */
function normalizeRemoteModelId(value: string): string {
  return value.replace(/^models\//u, '').trim()
}
