import { z } from 'zod'
import {
  AGENT_THINKING_LEVELS,
  type AgentThread,
  selectedAgentMessages
} from '../../shared/agent-chat'
import {
  createAgentThread,
  decideAgentTool,
  deleteAgentThread,
  readAgentEvents,
  renameAgentThread,
  selectAgentBranch,
  sendAgentMessage,
  stopAgentRun
} from '../lib/agent-chat-runner'
import { getAgentChatStore } from '../lib/agent-chat-store'
import { agentDirectorySummary } from '../lib/agent-run-event'
import { getPromptRunSnapshot, startPromptRun, stopPromptRun } from '../lib/ai-prompt-runner'
import { getDesktopTaskQueue } from '../lib/task-queue-host'
import { readTranscriptDetail } from '../lib/transcript-host'
import { settingsManager } from '../settings'
import { defineMcpTool, mcpId, mcpLimit, mcpOffset, mcpPage } from './tool'

const threadSchema = z.object({ threadId: mcpId })
const promptRunSchema = z.object({ downloadId: mcpId, promptId: mcpId })

/** Require an existing conversation so read operations never create hidden state. */
function requireThread(threadId: string): AgentThread {
  const thread = getAgentChatStore().get(threadId, { sessionEntries: false })
  if (!thread) {
    throw new Error(`Agent thread not found: ${threadId}`)
  }
  return thread
}

/** Publish run status, usage and approvals without SDK sessions or private system instructions. */
function threadStatus(thread: AgentThread) {
  return {
    ...agentDirectorySummary(thread),
    seq: thread.seq,
    leafId: thread.leafId,
    runs: thread.runs.slice(-20).map((run) => ({
      id: run.id,
      messageId: run.messageId,
      status: run.status,
      error: run.error,
      errorCode: run.errorCode,
      model: run.model,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      tools: run.tools,
      usage: run.usage
    })),
    artifacts: thread.artifacts,
    images: thread.images ?? []
  }
}

/** Expose saved skills, prompt runs and persistent Agent conversations without native dialogs. */
export function createMcpAiTools() {
  return [
    defineMcpTool(
      'list_agent_threads',
      'Search persistent AI conversations, optionally restricted to a media ID. Follow nextOffset.',
      z.object({
        downloadId: mcpId.optional(),
        query: z.string().max(200).optional(),
        offset: mcpOffset,
        limit: mcpLimit
      }),
      ({ downloadId, query, offset, limit }) => {
        const store = getAgentChatStore()
        const items = (downloadId ? store.listVideoThreads(downloadId) : store.listHistory())
          .map(agentDirectorySummary)
          .sort((left, right) => right.updatedAt - left.updatedAt)
        const needle = query?.toLocaleLowerCase() ?? ''
        return mcpPage(
          items.filter((item) => `${item.id}\n${item.title}`.toLocaleLowerCase().includes(needle)),
          offset,
          limit
        )
      },
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'get_agent_thread',
      'Read a conversation status, pending approvals, artifacts and paginated selected-branch messages. Long message text can be read with get_agent_message.',
      threadSchema.extend({
        offset: mcpOffset,
        limit: mcpLimit,
        allBranches: z.boolean().default(false)
      }),
      ({ threadId, offset, limit, allBranches }) => {
        const thread = requireThread(threadId)
        const messages = allBranches ? thread.messages : selectedAgentMessages(thread)
        const page = mcpPage(messages, offset, limit)
        return {
          ...threadStatus(thread),
          ...page,
          items: page.items.map(({ thinking: _thinking, ...message }) => ({
            ...message,
            text: message.text.slice(0, 10_000),
            textLength: message.text.length,
            truncated: message.text.length > 10_000
          }))
        }
      },
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'get_agent_message',
      'Read a long conversation message in character pages, optionally including model thinking.',
      threadSchema.extend({
        messageId: mcpId,
        offset: mcpOffset,
        limit: z.number().int().min(1).max(50_000).default(10_000),
        includeThinking: z.boolean().default(false)
      }),
      ({ threadId, messageId, offset, limit, includeThinking }) => {
        const message = requireThread(threadId).messages.find((item) => item.id === messageId)
        if (!message) {
          throw new Error('Message not found')
        }
        return {
          id: message.id,
          role: message.role,
          text: message.text.slice(offset, offset + limit),
          totalCharacters: message.text.length,
          nextOffset:
            offset + limit <
            Math.max(message.text.length, includeThinking ? message.thinking.length : 0)
              ? offset + limit
              : null,
          thinking: includeThinking ? message.thinking.slice(offset, offset + limit) : undefined,
          thinkingCharacters: includeThinking ? message.thinking.length : undefined
        }
      },
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'create_agent_thread',
      'Create a blank AI conversation attached to an existing media task. Sending a message starts the model run.',
      z.object({ downloadId: mcpId }),
      ({ downloadId }) => {
        if (!getDesktopTaskQueue().get(downloadId)) {
          throw new Error('Media task not found')
        }
        return threadStatus(createAgentThread(downloadId))
      }
    ),
    defineMcpTool(
      'send_agent_message',
      'Send a message to a saved conversation using the configured AI provider. Returns immediately; poll get_agent_thread. Saved transcript context is loaded by Desktop.',
      threadSchema.extend({
        text: z.string().min(1).max(20_000),
        thinkingLevel: z.enum(AGENT_THINKING_LEVELS).optional(),
        retryMessageId: mcpId.optional()
      }),
      ({ threadId, ...input }) => {
        const thread = requireThread(threadId)
        return threadStatus(
          sendAgentMessage({
            ...input,
            threadId,
            downloadId: thread.downloadId,
            promptId: thread.promptId,
            uiLanguage: settingsManager.get('language')
          })
        )
      },
      { openWorldHint: true }
    ),
    defineMcpTool(
      'manage_agent_thread',
      'Stop a model run, rename/delete a conversation, or restore a reply branch. title is required for rename; messageId for select_branch.',
      threadSchema.extend({
        action: z.enum(['stop', 'rename', 'delete', 'select_branch']),
        title: z.string().min(1).max(200).optional(),
        messageId: mcpId.optional()
      }),
      async ({ threadId, action, title, messageId }) => {
        requireThread(threadId)
        switch (action) {
          case 'stop': {
            const thread = await stopAgentRun(threadId)
            return thread ? threadStatus(thread) : null
          }
          case 'rename':
            if (!title) {
              throw new Error('title is required')
            }
            renameAgentThread(threadId, title)
            return threadStatus(requireThread(threadId))
          case 'delete':
            await deleteAgentThread(threadId)
            return { deleted: true }
          case 'select_branch':
            if (!messageId) {
              throw new Error('messageId is required')
            }
            return threadStatus(selectAgentBranch(threadId, messageId))
          default:
            throw new Error('Unknown conversation action')
        }
      },
      { destructiveHint: true }
    ),
    defineMcpTool(
      'decide_agent_tool',
      'Approve or reject one pending tool call in the built-in Agent. Inspect its approval in get_agent_thread first; remember defaults false.',
      threadSchema.extend({
        toolCallId: mcpId,
        approved: z.boolean(),
        remember: z.boolean().default(false)
      }),
      (input) => {
        requireThread(input.threadId)
        decideAgentTool(input)
        return { submitted: true }
      },
      { destructiveHint: true }
    ),
    defineMcpTool(
      'get_agent_events',
      'Recover up to 50 committed conversation events after a sequence number. Follow nextAfter when hasMore is true.',
      threadSchema.extend({ after: z.number().int().nonnegative().default(0) }),
      ({ threadId, after }) => {
        requireThread(threadId)
        const result = readAgentEvents(threadId, after)
        const events = result.events.slice(0, 50)
        return {
          events,
          nextAfter: events.at(-1)?.seq ?? after,
          hasMore: result.events.length > events.length,
          thread: threadStatus(requireThread(threadId))
        }
      },
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'start_ai_prompt',
      'Run a saved AI prompt/skill on the selected stored transcript with the configured provider. Returns admission; read get_ai_prompt_run for streamed output.',
      promptRunSchema.extend({ forceRegenerate: z.boolean().default(false) }),
      ({ downloadId, promptId, forceRegenerate }) => {
        const snapshot = readTranscriptDetail(downloadId)
        if (!snapshot.record?.segments.length) {
          throw new Error('A non-empty transcript is required')
        }
        const result = startPromptRun({
          downloadId,
          promptId,
          forceRegenerate,
          transcriptText: snapshot.record.segments.map((segment) => segment.text).join('\n'),
          uiLanguage: settingsManager.get('language'),
          sourceUrl: getDesktopTaskQueue().get(downloadId)?.input.url,
          transcriptLanguage: snapshot.record.language ?? undefined,
          transcriptOrigin: snapshot.record.sourceKind === 'asr' ? 'ai' : 'human'
        })
        return { downloadId, promptId, status: result.status, error: result.error }
      },
      { openWorldHint: true }
    ),
    defineMcpTool(
      'get_ai_prompt_run',
      'Read a saved skill run status/error and paginated generated text.',
      promptRunSchema.extend({
        offset: mcpOffset,
        limit: z.number().int().min(1).max(50_000).default(10_000)
      }),
      ({ downloadId, promptId, offset, limit }) => {
        const {
          thinking: _thinking,
          text,
          ...snapshot
        } = getPromptRunSnapshot(downloadId, promptId)
        return {
          ...snapshot,
          text: text.slice(offset, offset + limit),
          totalCharacters: text.length,
          nextOffset: offset + limit < text.length ? offset + limit : null
        }
      },
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'stop_ai_prompt',
      'Cancel the identified AI prompt/skill run without stopping other conversations.',
      promptRunSchema,
      ({ downloadId, promptId }) => {
        const {
          text: _text,
          thinking: _thinking,
          ...snapshot
        } = stopPromptRun(downloadId, promptId)
        return snapshot
      }
    )
  ]
}
