import type {
  Api,
  AssistantMessage,
  Context,
  FetchFunction,
  Model,
  Provider
} from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/compat'
import { createModels } from '@earendil-works/pi-ai/models'

/** Bind Durable to the application's selected transport without persisting credentials. */
export function createAgentModels(options: {
  model: Model<Api>
  apiKey: string
  fetch?: FetchFunction
  signal?: AbortSignal
  outputTokens?: () => number
  onUsage?: (message: AssistantMessage) => void
  onBeforeStream?: (context: Context) => void
}) {
  const models = createModels()
  const dispatch: Provider['streamSimple'] = (model, context, streamOptions) => {
    options.onBeforeStream?.(context)
    const cap = options.outputTokens?.() ?? model.maxTokens
    const stream = streamSimple(model, context, {
      ...streamOptions,
      apiKey: options.apiKey,
      fetch: options.fetch,
      signal: options.signal
        ? AbortSignal.any([
            options.signal,
            ...(streamOptions?.signal ? [streamOptions.signal] : [])
          ])
        : streamOptions?.signal,
      maxRetries: 0,
      maxTokens: cap > 0 ? Math.min(streamOptions?.maxTokens ?? cap, cap) : 0
    })
    if (options.onUsage) {
      void stream
        .result()
        .then(options.onUsage)
        .catch(() => undefined)
    }
    return stream
  }
  models.setProvider({
    id: options.model.provider,
    name: options.model.provider,
    auth: {
      apiKey: { name: 'VidBee', resolve: async () => ({ auth: { apiKey: options.apiKey } }) }
    },
    getModels: () => [options.model],
    stream: (model, context, streamOptions) =>
      dispatch(model, context, { signal: streamOptions?.signal }),
    streamSimple: dispatch
  })
  return models
}
