import type { Api, Model } from '@earendil-works/pi-ai'
import { aiProviderNeedsApiKey, aiProviderRequiresBaseUrl } from '../../shared/ai-presets'
import {
  classifyAiPromptError,
  flattenErrorMessage,
  formatAiPromptError
} from '../../shared/ai-run'
import type {
  AiPromptErrorCode,
  AiProviderTestResult,
  AiProviderWriteInput
} from '../../shared/ai-types'
import { scopedLoggers } from '../utils/logger'
import { resolvePiModel } from './ai-model'
import {
  assistantErrorFromMessage,
  assistantTextFromMessage,
  createPiPromptAgent,
  type PromptAgentLike
} from './ai-prompt-runner'
import { aiStore } from './ai-store'

const log = scopedLoggers.ai
const TEST_SYSTEM_PROMPT = 'Reply with one short word only. Do not add punctuation or explanation.'
const TEST_USER_PROMPT = 'ping'
const TEST_TIMEOUT_MS = 20_000

export interface ProviderTestDeps {
  createAgent: (input: {
    systemPrompt: string
    model: Model<Api>
    apiKey: string
  }) => PromptAgentLike
  resolveApiKey: (input: AiProviderWriteInput) => string
  timeoutMs: number
}

/**
 * Build a failed connectivity result.
 *
 * @param error Human-readable failure.
 * @param errorCode Guidance code.
 */
const fail = (error: string, errorCode: AiPromptErrorCode): AiProviderTestResult => ({
  ok: false,
  text: '',
  error,
  errorCode
})

/**
 * Use the typed key, or the stored key when editing and the field was left blank.
 *
 * @param input Dialog values.
 */
const defaultResolveApiKey = (input: AiProviderWriteInput): string => {
  const typed = input.apiKey?.trim()
  if (typed) {
    return typed
  }
  return input.id ? aiStore.getProviderSecret(input.id) : ''
}

/**
 * Send a short ping through the same agent path as transcript prompts.
 *
 * @param input Dialog values, including an optional API key.
 * @param deps Optional test doubles.
 */
export const testProviderConnection = async (
  input: AiProviderWriteInput,
  deps: Partial<ProviderTestDeps> = {}
): Promise<AiProviderTestResult> => {
  const createAgent = deps.createAgent ?? createPiPromptAgent
  const resolveApiKey = deps.resolveApiKey ?? defaultResolveApiKey
  const timeoutMs = deps.timeoutMs ?? TEST_TIMEOUT_MS
  const modelId = input.modelId.trim()
  if (!modelId) {
    return fail('The enabled provider is missing a model id', 'missing-model')
  }
  if (aiProviderRequiresBaseUrl(input.presetId) && !input.baseUrl?.trim()) {
    return fail('Base URL is required', 'network')
  }
  const apiKey = resolveApiKey(input)
  if (aiProviderNeedsApiKey(input.presetId) && !apiKey) {
    return fail('The enabled provider is missing an API key', 'missing-api-key')
  }

  const model = resolvePiModel({
    presetId: input.presetId,
    modelId,
    baseUrl: input.baseUrl,
    contextWindow: input.contextWindow,
    vision: input.vision,
    reasoning: input.reasoning,
    thinkingOnly: input.thinkingOnly,
    thinkingLevels: input.thinkingLevels,
    allowDisableThinking: input.allowDisableThinking,
    maxTokens: input.maxTokens
  })
  const agent = createAgent({ systemPrompt: TEST_SYSTEM_PROMPT, model, apiKey })
  log.info('ai provider test started', { presetId: input.presetId, modelId })

  try {
    const result = await waitForTestReply(agent, timeoutMs)
    if (result.error || !result.text.trim()) {
      const error = formatAiPromptError(result.error || 'The model returned no text')
      const errorCode = classifyAiPromptError(result.error, !result.text.trim())
      log.warn('ai provider test failed', { presetId: input.presetId, modelId, error, errorCode })
      return { ok: false, text: result.text, error, errorCode }
    }
    log.info('ai provider test completed', { presetId: input.presetId, modelId })
    return { ok: true, text: result.text.trim(), error: null, errorCode: null }
  } catch (error: unknown) {
    const message = flattenErrorMessage(error) || 'Prompt failed'
    const errorCode = classifyAiPromptError(message)
    const errorText = formatAiPromptError(message)
    log.warn('ai provider test failed', {
      presetId: input.presetId,
      modelId,
      error: errorText,
      errorCode
    })
    return fail(errorText, errorCode)
  }
}

/**
 * Run the ping prompt and wait for text, an encoded model error, or a timeout.
 *
 * @param agent pi-agent bound to the dialog values.
 * @param timeoutMs Abort after this many milliseconds.
 */
const waitForTestReply = (
  agent: PromptAgentLike,
  timeoutMs: number
): Promise<{ text: string; error: string | null }> =>
  new Promise((resolve, reject) => {
    let text = ''
    let lastError: string | null = null
    let settled = false
    const unsubscribe = agent.subscribe((event) => {
      if (
        (event.type === 'message_update' ||
          event.type === 'message_end' ||
          event.type === 'turn_end') &&
        event.message.role === 'assistant'
      ) {
        lastError = assistantErrorFromMessage(event.message) ?? lastError
        const next = assistantTextFromMessage(event.message)
        if (next) {
          text = next
        }
      }
    })

    /**
     * Finish once, then ignore a late prompt() settle after abort.
     *
     * @param next Success or failure callback.
     */
    const finish = (next: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      unsubscribe()
      next()
    }

    const timer = setTimeout(() => {
      agent.abort()
      finish(() => reject(new Error('The request timed out')))
    }, timeoutMs)

    void agent
      .prompt(TEST_USER_PROMPT)
      .then(() => finish(() => resolve({ text, error: lastError })))
      .catch((error: unknown) =>
        finish(() => reject(error instanceof Error ? error : new Error('Prompt failed')))
      )
  })
