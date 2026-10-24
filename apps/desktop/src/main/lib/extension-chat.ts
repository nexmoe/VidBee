import { randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'
import { AGENT_MAX_MESSAGE_IMAGES, AGENT_THINKING_LEVELS } from '../../shared/agent-chat'
import { isUuid } from '../../shared/agent-history'
import { selectedAgentRunView } from '../../shared/agent-thread-patch'
import { AI_CHAT_PROMPT_ID } from '../../shared/ai-prompts'
import type { ExtensionChatCommand, ExtensionChatState } from '../../shared/extension-chat'
import { resolveAgentArtifact } from './agent-artifacts'
import {
  createAgentThread,
  decideAgentTool,
  deleteAgentThread,
  openAgentThread,
  removeAgentImage,
  renameAgentThread,
  selectAgentBranch,
  sendAgentMessage,
  setAgentThinkingLevel,
  stopAgentRun
} from './agent-chat-runner'
import { getAgentChatStore } from './agent-chat-store'
import { getAgentComposerOptions } from './agent-composer'
import { listAgentConversations } from './agent-conversations'
import { getAgentCatalogRevision } from './agent-run-event'
import { aiStore } from './ai-store'
import { executeExtensionChatAction } from './extension-chat-actions'
import {
  browserChatThread,
  extensionChatVideo,
  streamExtensionChatEvents
} from './extension-chat-events'
import { admitExtensionChatRequest } from './extension-chat-requests'
import { isExtensionChatSource, resolveExtensionChatSource } from './extension-chat-source'
import { applyExtensionCors, extensionRequestOrigin, replyExtensionJson } from './extension-origin'

const PREFIX = '/extension/v1/chat'
const TTL_MS = 60 * 60 * 1000
const MAX_SESSIONS = 32
interface ChatSession {
  origin: string
  token: string
  downloadId: string
  threadId?: string
  expiresAt: number
  streams: Set<() => void>
  exporting?: boolean
}
const sessions = new Map<string, ChatSession>()

/** Route only the authenticated extension conversation API. */
export function isExtensionChatPath(pathname: string): boolean {
  return pathname === PREFIX || pathname.startsWith(`${PREFIX}/`)
}

/** Bound request bodies before parsing source evidence or chat mutations. */
async function readJson(req: IncomingMessage, limit = 2_000_000): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > limit) {
      throw new Error('Request is too large')
    }
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Reject malformed commands before they reach the shared Desktop business logic. */
function validCommand(value: unknown): value is ExtensionChatCommand {
  if (!value || typeof value !== 'object') {
    return false
  }
  const command = value as Record<string, unknown>
  if (command.type === 'create') {
    return typeof command.requestId === 'string' && isUuid(command.requestId)
  }
  if (command.type === 'open') {
    return (
      typeof command.promptId === 'string' &&
      command.promptId.length > 0 &&
      command.promptId.length <= 256 &&
      (command.threadId === undefined ||
        (typeof command.threadId === 'string' && isUuid(command.threadId))) &&
      (command.followSource === undefined || typeof command.followSource === 'boolean')
    )
  }
  if (typeof command.threadId !== 'string' || !isUuid(command.threadId)) {
    return false
  }
  if (command.type === 'send') {
    return (
      typeof command.requestId === 'string' &&
      isUuid(command.requestId) &&
      (command.text === undefined ||
        (typeof command.text === 'string' && command.text.length <= 20_000)) &&
      (command.retryMessageId === undefined ||
        (typeof command.retryMessageId === 'string' && isUuid(command.retryMessageId))) &&
      (command.imageIds === undefined ||
        (Array.isArray(command.imageIds) &&
          command.imageIds.length <= AGENT_MAX_MESSAGE_IMAGES &&
          command.imageIds.every((id) => typeof id === 'string' && isUuid(id)))) &&
      (command.thinkingLevel === undefined ||
        AGENT_THINKING_LEVELS.some((level) => level === command.thinkingLevel))
    )
  }
  if (command.type === 'thinking') {
    return AGENT_THINKING_LEVELS.some((level) => level === command.level)
  }
  if (command.type === 'remove-image') {
    return typeof command.imageId === 'string' && isUuid(command.imageId)
  }
  if (command.type === 'stop' || command.type === 'delete') {
    return true
  }
  if (command.type === 'branch') {
    return typeof command.messageId === 'string' && isUuid(command.messageId)
  }
  if (command.type === 'rename') {
    return (
      typeof command.title === 'string' &&
      command.title.trim().length > 0 &&
      command.title.length <= 80
    )
  }
  return (
    command.type === 'approve' &&
    typeof command.toolCallId === 'string' &&
    command.toolCallId.length > 0 &&
    command.toolCallId.length <= 256 &&
    typeof command.approved === 'boolean' &&
    typeof command.remember === 'boolean'
  )
}

/** Read one committed directory and the live selected conversation from Desktop. */
function state(session: ChatSession): ExtensionChatState {
  const selected = session.threadId ? getAgentChatStore().get(session.threadId) : null
  if (!selected) {
    session.threadId = undefined
  }
  const threads = listAgentConversations(session.downloadId)
  const history = listAgentConversations()
  const sources = Object.fromEntries(
    [...new Set([session.downloadId, ...history.map((item) => item.downloadId)])].flatMap((id) => {
      const source = extensionChatVideo(id)
      return source ? [[id, source]] : []
    })
  )
  const statuses = Object.fromEntries(
    aiStore.getSnapshot().prompts.map((prompt) => [
      prompt.id,
      (() => {
        const stored = getAgentChatStore().loadPromptThreadView(session.downloadId, prompt.id)
        return stored ? selectedAgentRunView(stored) : { status: 'idle' as const, updatedAt: 0 }
      })()
    ])
  )
  return {
    revision: getAgentCatalogRevision(),
    catalog: {
      downloadId: session.downloadId,
      prompts: aiStore.getSnapshot().prompts,
      threads,
      history,
      sources,
      statuses
    },
    thread: selected
      ? browserChatThread(openAgentThread(selected.downloadId, selected.promptId, selected.id))
      : null
  }
}

/** Apply the same operations as Desktop IPC, with idempotent admission for transport retries. */
async function execute(session: ChatSession, command: ExtensionChatCommand): Promise<void> {
  if (command.type === 'create' || command.type === 'send') {
    session.threadId = admitExtensionChatRequest(session.origin, command.requestId, command, () => {
      if (command.type === 'create') {
        return createAgentThread(session.downloadId).id
      }
      const stored = getAgentChatStore().get(command.threadId)
      if (!stored) {
        throw new Error('Conversation no longer exists')
      }
      return sendAgentMessage({
        downloadId: stored.downloadId,
        promptId: stored.promptId,
        threadId: stored.id,
        text: command.text,
        retryMessageId: command.retryMessageId,
        thinkingLevel: command.thinkingLevel,
        imageIds: command.imageIds,
        uiLanguage: 'en'
      }).id
    })
    return
  }
  if (command.type === 'open') {
    if (
      !command.threadId &&
      command.promptId !== AI_CHAT_PROMPT_ID &&
      !aiStore
        .getSnapshot()
        .prompts.some((prompt) => prompt.id === command.promptId && prompt.enabled)
    ) {
      throw new Error('Skill is no longer available')
    }
    const stored = command.threadId ? getAgentChatStore().get(command.threadId) : null
    if (command.threadId && !stored) {
      throw new Error('Conversation no longer exists')
    }
    const thread = openAgentThread(
      stored?.downloadId ?? session.downloadId,
      command.promptId,
      command.threadId
    )
    session.threadId = thread.id
    if (command.followSource) {
      session.downloadId = thread.downloadId
    }
    return
  }
  const stored = getAgentChatStore().get(command.threadId)
  if (!stored) {
    throw new Error('Conversation no longer exists')
  }
  if (command.type === 'thinking') {
    setAgentThinkingLevel(stored.id, command.level)
    return
  }
  if (command.type === 'remove-image') {
    await removeAgentImage(stored.id, command.imageId)
    return
  }
  if (command.type === 'rename') {
    renameAgentThread(stored.id, command.title)
    return
  }
  if (command.type === 'delete') {
    await deleteAgentThread(stored.id)
    if (session.threadId === stored.id) {
      session.threadId = undefined
    }
    return
  }
  session.threadId = stored.id
  if (command.type === 'stop') {
    await stopAgentRun(stored.id)
  } else if (command.type === 'branch') {
    selectAgentBranch(stored.id, command.messageId)
  } else if (command.type === 'approve') {
    decideAgentTool({
      threadId: stored.id,
      toolCallId: command.toolCallId,
      approved: command.approved,
      remember: command.remember
    })
  }
}

/** Authenticate session bootstrap, directory refreshes, and conversation operations. */
export async function handleExtensionChat(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  consumeToken: (token: string, origin: string) => boolean
): Promise<void> {
  const origin = extensionRequestOrigin(req)
  if (!origin) {
    replyExtensionJson(res, 403, { error: 'Extension origin required' })
    return
  }
  applyExtensionCors(res, origin)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  for (const [id, session] of sessions) {
    if (session.expiresAt <= Date.now()) {
      for (const close of session.streams) {
        close()
      }
      sessions.delete(id)
    }
  }
  const token = req.headers.authorization?.replace(/^Bearer /i, '') ?? ''
  try {
    if (pathname === PREFIX && req.method === 'POST') {
      if (!consumeToken(token, origin)) {
        replyExtensionJson(res, 401, { error: 'Invalid start token' })
        return
      }
      const source = await readJson(req)
      const storedId =
        source &&
        typeof source === 'object' &&
        'downloadId' in source &&
        typeof source.downloadId === 'string' &&
        source.downloadId.length <= 256
          ? source.downloadId
          : undefined
      if (!(isExtensionChatSource(source) || (storedId && extensionChatVideo(storedId)))) {
        replyExtensionJson(res, 400, { error: 'Invalid video captions' })
        return
      }
      const downloadId = isExtensionChatSource(source)
        ? await resolveExtensionChatSource(source)
        : (storedId ?? '')
      if (sessions.size >= MAX_SESSIONS) {
        const oldest = [...sessions.entries()].sort(
          (left, right) => left[1].expiresAt - right[1].expiresAt
        )[0]
        if (oldest) {
          for (const close of oldest[1].streams) {
            close()
          }
          sessions.delete(oldest[0])
        }
      }
      const id = randomBytes(32).toString('hex')
      const session: ChatSession = {
        origin,
        streams: new Set(),
        downloadId,
        token: randomBytes(32).toString('hex'),
        expiresAt: Date.now() + TTL_MS
      }
      sessions.set(id, session)
      replyExtensionJson(res, 200, { session: { id, token: session.token }, ...state(session) })
      return
    }
    const parts = pathname.slice(PREFIX.length + 1).split('/')
    const id = parts[0]
    const session = sessions.get(id)
    if (!session || session.origin !== origin || session.token !== token) {
      replyExtensionJson(res, 401, { error: 'Chat session expired' })
      return
    }
    session.expiresAt = Date.now() + TTL_MS
    if (parts.length === 2 && parts[1] === 'events' && req.method === 'GET') {
      if (session.streams.size >= 4) {
        replyExtensionJson(res, 429, { error: 'Too many chat connections' })
        return
      }
      const close = streamExtensionChatEvents(
        req,
        res,
        () => state(session),
        () => session.threadId,
        () => {
          session.expiresAt = Date.now() + TTL_MS
        }
      )
      session.streams.add(close)
      res.once('close', () => session.streams.delete(close))
      return
    }
    if (parts.length === 2 && parts[1] === 'options' && req.method === 'GET') {
      replyExtensionJson(res, 200, await getAgentComposerOptions())
      return
    }
    if (
      parts.length === 2 &&
      ['model', 'images', 'export', 'feedback'].includes(parts[1]) &&
      req.method === 'POST'
    ) {
      const action = parts[1]
      if (action === 'export' && session.exporting) {
        replyExtensionJson(res, 429, { error: 'An export is already running' })
        return
      }
      const input = await readJson(req, action === 'images' ? 28_001_000 : 2_000_000)
      const abort = new AbortController()
      res.once('close', () => abort.abort())
      if (action === 'export') {
        session.exporting = true
      }
      try {
        const result = await executeExtensionChatAction(action, input, abort.signal)
        replyExtensionJson(res, 200, { result, state: state(session) })
      } finally {
        if (action === 'export') {
          session.exporting = false
        }
      }
      return
    }
    if (parts.length === 2 && parts[1] === 'media' && req.method === 'POST') {
      const input = (await readJson(req)) as {
        threadId?: unknown
        artifactId?: unknown
        poster?: unknown
      }
      if (
        !input ||
        typeof input.threadId !== 'string' ||
        !isUuid(input.threadId) ||
        typeof input.artifactId !== 'string' ||
        !isUuid(input.artifactId) ||
        (input.poster !== undefined && typeof input.poster !== 'boolean')
      ) {
        replyExtensionJson(res, 400, { error: 'Invalid attachment' })
        return
      }
      try {
        const file = await resolveAgentArtifact(
          input.threadId,
          input.artifactId,
          input.poster === true
        )
        const mime = (
          {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.mp4': 'video/mp4'
          } as Record<string, string>
        )[extname(file).toLowerCase()]
        if (!mime || (await stat(file)).size > 32_000_000) {
          replyExtensionJson(res, 413, { error: 'Attachment is too large to show in the browser' })
          return
        }
        const bytes = await readFile(file)
        if (bytes.byteLength > 32_000_000) {
          replyExtensionJson(res, 413, { error: 'Attachment is too large to show in the browser' })
          return
        }
        replyExtensionJson(res, 200, { dataUrl: `data:${mime};base64,${bytes.toString('base64')}` })
      } catch {
        replyExtensionJson(res, 404, { error: 'Attachment unavailable' })
      }
      return
    }
    if (parts.length !== 1) {
      replyExtensionJson(res, 404, { error: 'Unknown chat endpoint' })
      return
    }
    if (req.method === 'GET') {
      replyExtensionJson(res, 200, state(session))
      return
    }
    if (req.method !== 'POST') {
      replyExtensionJson(res, 405, { error: 'Method not allowed' })
      return
    }
    const command = await readJson(req)
    if (!validCommand(command)) {
      replyExtensionJson(res, 400, { error: 'Invalid chat command' })
      return
    }
    await execute(session, command)
    replyExtensionJson(res, 200, state(session))
  } catch (error) {
    replyExtensionJson(res, 400, {
      error: error instanceof Error ? error.message : 'Desktop chat failed'
    })
  }
}

/** Revoke browser capabilities on shutdown; persistent conversations keep their normal lifetime. */
export function clearExtensionChats(): void {
  for (const session of sessions.values()) {
    for (const close of session.streams) {
      close()
    }
  }
  sessions.clear()
}
