import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context'
import type { AgentToolResult, AgentToolUpdateCallback } from '@earendil-works/pi-agent-core'
import type { ToolResultMessage } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  type Conversation,
  createRegistry,
  defineExtension,
  Harness,
  type JsonObject,
  MemoryStorage,
  type ToolRegistration,
  ToolTask
} from '@earendil-works/pi-durable'
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node'
import type { AgentRuntimeTool } from './agent-session-types'

/** Execute an explicitly requested tool through Durable's validation, hooks and task scheduler. */
export async function executeDurableTool(
  harness: Harness,
  conversation: Conversation,
  name: string,
  id: string,
  args: JsonObject,
  signal?: AbortSignal
) {
  const context = signal ? withAbortSignal(signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT
  const task = await conversation.commit(async (tx) => {
    const entry = await tx.appendEntry(conversation.id, {
      kind: 'pi.assistant',
      model: [
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id, name, arguments: args }],
          api: 'openai-completions',
          provider: 'vidbee',
          model: 'tool',
          stopReason: 'toolUse',
          timestamp: Date.now(),
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          }
        }
      ]
    })
    return tx.createTask(
      ToolTask,
      { kind: 'model', assistant: entry.id, callId: id },
      { ownership: { kind: 'conversation' } }
    )
  }, context)
  try {
    const settled = await harness.waitForTask(task, context)
    const outcome = settled.state.outcome
    const receipt = 'result' in outcome ? outcome.result : undefined
    if (receipt?.kind !== 'model') {
      throw new Error(
        `The tool did not complete: ${outcome.status === 'failed' ? outcome.error.message : outcome.status}`
      )
    }
    const entryId = receipt.entryId
    if (receipt.control?.addTools?.length) {
      const names = new Set(receipt.control.addTools)
      const agent = await conversation.agent(context)
      const offered = new Map(agent.tools.map((tool) => [tool.name, tool]))
      for (const tool of agent.callable) {
        if (names.has(tool.name)) {
          offered.set(tool.name, tool)
        }
      }
      await conversation.configure({ modelTools: { add: [...offered.values()] } }, context)
    }
    const entry = await harness.commit((tx) => tx.entry(entryId), context)
    const message = entry?.model?.[0]
    if (message?.role !== 'toolResult') {
      throw new Error('The tool returned no result')
    }
    return message
  } finally {
    if (signal?.aborted) {
      await harness.abortTask(task, BACKGROUND_CONTEXT)
    }
  }
}

/** Preserve the application tool contract while registering the actual native Durable implementation. */
export function agentNativeTool(
  tool: ToolRegistration,
  cwd: string,
  signal: AbortSignal
): AgentRuntimeTool {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    durableTool: tool,
    /** Standalone callers use the same official scheduler without a model request. */
    async execute(
      id: string,
      args: unknown,
      executionSignal?: AbortSignal,
      _onUpdate?: AgentToolUpdateCallback
    ): Promise<AgentToolResult<unknown>> {
      const registry = createRegistry()
      registry.install(
        defineExtension({ name: 'vidbee-native-tool', tools: [{ ...tool, deferred: undefined }] })
      )
      const harness = await Harness.open(
        new MemoryStorage(),
        { registry, models: createModels(), env: () => new NodeExecutionEnv({ cwd }) },
        BACKGROUND_CONTEXT
      )
      try {
        const conversation = await harness.root(BACKGROUND_CONTEXT)
        const message: ToolResultMessage = await executeDurableTool(
          harness,
          conversation,
          tool.name,
          id,
          args as JsonObject,
          executionSignal ? AbortSignal.any([signal, executionSignal]) : signal
        )
        return { content: message.content, details: message.details ?? {} }
      } finally {
        await harness.close(BACKGROUND_CONTEXT)
      }
    }
  }
}
