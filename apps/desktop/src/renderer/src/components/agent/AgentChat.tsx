import { AgentChatScrollState } from '@renderer/components/transcript/AgentChatScrollState'
import { AgentReasoningSelect } from '@renderer/components/transcript/AgentReasoningSelect'
import { agentArtifactUrl } from '@renderer/components/transcript/AgentResponseContent'
import { TranscriptAgentMessages } from '@renderer/components/transcript/TranscriptAgentMessageRow'
import { TranscriptPromptGuidance } from '@renderer/components/transcript/TranscriptPromptGuidance'
import { TranscriptShareImageDialog } from '@renderer/components/transcript/TranscriptShareImageDialog'
import { Button } from '@renderer/components/ui/button'
import { MessageScrollerItem } from '@renderer/components/ui/message-scroller'
import { useAgentChat } from '@renderer/hooks/use-agent-chat'
import { aiPromptLabel } from '@renderer/lib/ai-prompt-label'
import { shareImageFileName } from '@renderer/lib/capture-prompt-share'
import { trackDesktopEvent } from '@renderer/lib/desktop-analytics'
import { ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import { thinkingDurationHeader } from '@renderer/lib/thinking-header'
import { agentTaskAiSnapshotAtom } from '@renderer/store/agent-tasks'
import { downloadsArrayAtom } from '@renderer/store/downloads'
import {
  AGENT_MAX_MESSAGE_IMAGES,
  AGENT_WORKSPACE_ID,
  type AgentChatMessage,
  draftAgentImages,
  selectedAgentMessages
} from '@shared/agent-chat'
import { artifactsForMessage } from '@shared/agent-markdown'
import type { AgentUiResponse } from '@shared/agent-ui'
import {
  AI_CHAT_PROMPT_ID,
  AI_OVERVIEW_PROMPT_ID,
  agentChatPrompt,
  aiPromptDescription
} from '@shared/ai-prompts'
import type { AiPrompt } from '@shared/ai-types'
import { sharePromptUserText } from '@shared/types/share-card'
import { AgentChatComposer } from '@vidbee/ui/components/agent-chat-composer'
import { AgentConversationLayout } from '@vidbee/ui/components/agent-workspace'
import { useMessageSendTransition } from '@vidbee/ui/components/ui/message-send-transition'
import { useAtom, useAtomValue } from 'jotai'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AgentUiProvider } from './AgentUiCards'
import { ChatSuggestions } from './ChatSuggestions'

interface OutgoingMessage {
  identity: string
  message: AgentChatMessage
  previousIds: Set<string>
  admitted: boolean
  finished: boolean
}

export interface AgentChatProps {
  /** Omit the video identity to start a standalone conversation. */
  downloadId?: string
  hasProvider: boolean
  /** Seed a new conversation's editable composer without submitting it. */
  initialDraft?: string
  prompt?: AiPrompt
  /** Open this conversation instead of the prompt's get-or-create thread. */
  threadId?: string | null
  /** Report the opened conversation so its parent can select it in history. */
  onThreadChange?: (threadId: string) => void
  ready?: boolean
  settingsReady: boolean
  /** Cached local cover URL printed on the share card. */
  sourceCover?: string | null
  /** Platform and channel printed under the share card title. */
  sourceByline?: string | null
  /** Media title printed on the share card header. */
  sourceTitle?: string | null
  /** Seek the player when a prompt clock token is clicked. */
  onSeek?: (seconds: number) => void
  /** Player current time so Overview can highlight the live chapter. */
  currentTimeMs?: number
  /** Media duration used as the last Overview chapter end. */
  sourceDurationMs?: number
  /** First-pass ASR is still running, so this prompt must wait. */
  transcriptRunning?: boolean
  /** Public video URL used as the Cloud cache identity. */
  sourceUrl?: string | null
  /** ISO 639 / BCP-47 language of the visible captions. */
  transcriptLanguage?: string | null
  /** Whether these captions came from ASR / platform-auto or a human track. */
  transcriptOrigin?: 'ai' | 'human'
  transcriptText?: string
  /** True when Desktop already has a stored transcript record; skip the IPC haul. */
  hasStoredTranscript?: boolean
}

const CLOUD_FIRST_SUCCESS_STORAGE_KEY = 'vidbee.desktop.cloud-first-success'
let cloudFirstSuccessShown = false

/**
 * Prompts the user armed to run when the transcript is ready.
 * The skill pane unmounts on tab and page changes, so this cannot live in component state.
 */
const armedPromptIdentities = new Set<string>()

/**
 * Remember that this prompt should keep its waiting state across navigation.
 *
 * @param identity Thread id, or `downloadId:promptId` when the thread is not pinned.
 */
function armPromptIdentity(identity: string): void {
  armedPromptIdentities.add(identity)
}

/**
 * Drop the waiting mark once the prompt has started.
 *
 * @param identity Thread id, or `downloadId:promptId` when the thread is not pinned.
 */
function disarmPromptIdentity(identity: string): void {
  armedPromptIdentities.delete(identity)
}

/** Forget armed prompts so unit tests do not leak across cases. */
export function resetArmedPromptIdentities(): void {
  armedPromptIdentities.clear()
}

/** Remember the first successful Cloud prompt without delaying prompt rendering. */
function markFirstCloudSuccess(): boolean {
  if (cloudFirstSuccessShown) {
    return false
  }
  try {
    if (window.localStorage.getItem(CLOUD_FIRST_SUCCESS_STORAGE_KEY)) {
      cloudFirstSuccessShown = true
      return false
    }
    window.localStorage.setItem(CLOUD_FIRST_SUCCESS_STORAGE_KEY, '1')
  } catch {
    // The in-memory guard still prevents repeated feedback in privacy-restricted environments.
  }
  cloudFirstSuccessShown = true
  return true
}

/**
 * Wait for ASR, and optionally arm a run the moment it finishes.
 *
 * @param props.armed Whether the user asked to run as soon as the transcript is ready.
 * @param props.onArm Remember that request.
 */
function TranscriptPromptWaiting({ armed, onArm }: { armed: boolean; onArm: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-start gap-3 p-4" data-testid="transcript-prompt-waiting">
      <p className="font-medium text-sm">{t('transcript.promptWaitForTranscript')}</p>
      <Button
        data-testid="transcript-prompt-run-when-ready"
        disabled={armed}
        onClick={onArm}
        size="sm"
        type="button"
      >
        {armed ? <Loader2 className="animate-spin" /> : null}
        {armed ? t('transcript.promptWaitingToRun') : t('transcript.promptRunWhenReady')}
      </Button>
    </div>
  )
}

/** Complete Agent conversation with messages, tools, composer, branches, and sharing. */
export function AgentChat({
  downloadId = AGENT_WORKSPACE_ID,
  hasProvider,
  initialDraft = '',
  prompt = agentChatPrompt(),
  threadId = null,
  onThreadChange,
  ready = true,
  settingsReady,
  onSeek,
  currentTimeMs = 0,
  sourceCover,
  sourceByline,
  sourceTitle,
  sourceUrl,
  sourceDurationMs = 0,
  transcriptRunning = false,
  transcriptText = '',
  hasStoredTranscript = false
}: AgentChatProps) {
  const { t, i18n } = useTranslation()
  const downloads = useAtomValue(downloadsArrayAtom)
  const [aiSnapshot, setAiSnapshot] = useAtom(agentTaskAiSnapshotAtom)
  const {
    thread,
    hydrated,
    error,
    sending,
    attaching,
    send,
    decideTool,
    stop,
    selectBranch,
    thinkingOptions,
    reloadThinkingOptions,
    setThinkingLevel,
    selectImages,
    removeImage
  } = useAgentChat(downloadId, prompt.name, threadId)
  const identity = threadId || `${downloadId}:${prompt.name}`
  const isChat = prompt.name === AI_CHAT_PROMPT_ID
  const standalone = downloadId === AGENT_WORKSPACE_ID
  const autoStarted = useRef(new Set<string>())
  const [, setArmedTick] = useState(0)
  const armed = armedPromptIdentities.has(identity)
  const preferredThinkingLevel = thread?.thinkingLevel
  const thinkingLevel =
    preferredThinkingLevel && thinkingOptions?.levels.includes(preferredThinkingLevel)
      ? preferredThinkingLevel
      : thinkingOptions?.defaultLevel
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    initialDraft ? { [identity]: initialDraft } : {}
  )
  const [outgoing, setOutgoing] = useState<OutgoingMessage | null>(null)
  const [shareMessageId, setShareMessageId] = useState<string | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const composerInput = useRef<HTMLDivElement>(null)
  const prepareSendTransition = useMessageSendTransition({
    identity,
    inputRef: composerInput,
    viewportRef: viewport
  })
  const composerInitiallyFocused = useRef(false)
  const cardResponsePending = useRef(false)
  const [selecting, setSelecting] = useState(false)
  const draft = drafts[identity] ?? ''
  const messages = thread ? selectedAgentMessages(thread) : []
  const preview = outgoing?.identity === identity ? outgoing : null
  const admittedMessage = preview
    ? messages.find(
        (message) =>
          message.role === 'user' &&
          !preview.previousIds.has(message.id) &&
          message.text === preview.message.text &&
          (message.imageIds ?? []).join('\n') === (preview.message.imageIds ?? []).join('\n')
      )
    : undefined
  const presentedMessages = preview && !admittedMessage ? [...messages, preview.message] : messages
  const presentedThread =
    thread && preview && !admittedMessage
      ? { ...thread, messages: [...thread.messages, preview.message] }
      : thread
  const images = thread
    ? draftAgentImages(thread).filter((image) => !preview?.message.imageIds?.includes(image.id))
    : []
  const canAttachImages = thinkingOptions?.vision && images.length < AGENT_MAX_MESSAGE_IMAGES
  const imagesUnsupported = images.length > 0 && !thinkingOptions?.vision
  const running = thread?.runs.some((run) => run.status === 'running') ?? false
  const busy = running || sending || attaching || Boolean(preview && !preview.admitted)
  const promptTitle = isChat ? t('transcript.promptHistoryChat') : aiPromptLabel(prompt, t)
  const shareMessage = messages.find((message) => message.id === shareMessageId)
  const transcriptReady = standalone || hasStoredTranscript || Boolean(transcriptText.trim())
  const context = {
    thinkingLevel,
    ...(hasStoredTranscript ? {} : { transcriptText }),
    uiLanguage: i18n.language,
    sourceTitle: sourceTitle ?? undefined,
    sourceDurationMs
  }
  const latestRun = thread?.runs.at(-1)

  /** Read the managed files on demand so newly installed or externally edited skills appear immediately. */
  async function refreshSkills(): Promise<void> {
    try {
      setAiSnapshot(await ipcServices.ai.getSnapshot())
    } catch (error) {
      logger.error('Failed to refresh composer skills', error)
    }
  }

  /** Focus new standalone chats and seeded drafts once the composer is mounted. */
  useEffect(() => {
    if (
      (initialDraft || (standalone && !threadId)) &&
      settingsReady &&
      hydrated &&
      !composerInitiallyFocused.current &&
      composerInput.current
    ) {
      composerInput.current.focus({ preventScroll: true })
      composerInitiallyFocused.current = true
    }
  }, [hydrated, initialDraft, settingsReady, standalone, threadId])

  useEffect(() => {
    if (thread?.id) {
      onThreadChange?.(thread.id)
    }
  }, [onThreadChange, thread?.id])

  useEffect(() => {
    if (
      isChat ||
      !(settingsReady && hydrated && thread && ready && transcriptReady) ||
      thread.messages.length ||
      autoStarted.current.has(identity)
    ) {
      return
    }
    if (transcriptRunning && !armed) {
      return
    }
    autoStarted.current.add(identity)
    disarmPromptIdentity(identity)
    void send({
      thinkingLevel,
      ...(hasStoredTranscript ? {} : { transcriptText }),
      uiLanguage: i18n.language,
      sourceTitle: sourceTitle ?? undefined,
      sourceDurationMs
    })
  }, [
    armed,
    hasStoredTranscript,
    hydrated,
    i18n.language,
    identity,
    isChat,
    ready,
    send,
    settingsReady,
    sourceDurationMs,
    sourceTitle,
    thinkingLevel,
    thread,
    transcriptReady,
    transcriptRunning,
    transcriptText
  ])

  useEffect(() => {
    if (
      !hasProvider &&
      latestRun?.cloudResultId &&
      latestRun.status === 'completed' &&
      markFirstCloudSuccess()
    ) {
      trackDesktopEvent('cloud_prompt_first_completed', { source: 'transcript_prompt' })
      toast.success(t('transcript.promptCloudGenerated'))
    }
  }, [hasProvider, latestRun?.status, latestRun?.cloudResultId, t])

  /** Present and animate immediately; keep a draft backup until the main process admits the send. */
  async function submit(): Promise<void> {
    if (!thread || busy || imagesUnsupported || !(draft.trim() || images.length)) {
      return
    }
    const message: AgentChatMessage = {
      id: crypto.randomUUID(),
      parentId: thread.leafId,
      runId: null,
      role: 'user',
      text: draft.trim(),
      imageIds: images.map((image) => image.id),
      thinking: '',
      createdAt: Date.now()
    }
    const animateMessage = prepareSendTransition(() => {
      setOutgoing((current) =>
        current?.message.id === message.id
          ? current.admitted
            ? null
            : { ...current, finished: true }
          : current
      )
    })
    flushSync(() => {
      setOutgoing({
        identity,
        message,
        previousIds: new Set(thread.messages.map((item) => item.id)),
        admitted: false,
        finished: false
      })
      setDrafts((current) => ({ ...current, [identity]: '' }))
      animateMessage()
    })
    const admitted = await send({
      ...context,
      text: draft,
      ...(message.imageIds?.length ? { imageIds: message.imageIds } : {})
    })
    setOutgoing((current) =>
      current?.message.id === message.id
        ? admitted && !current.finished
          ? { ...current, admitted: true }
          : null
        : current
    )
    if (!admitted) {
      setDrafts((current) => ({ ...current, [identity]: current[identity] || draft }))
    }
  }

  /** Fill and focus the composer without starting a model request or application action. */
  function selectSuggestion(text: string): void {
    if (busy || !ready || !thread) {
      return
    }
    setDrafts((current) => ({ ...current, [identity]: text }))
    composerInput.current?.focus()
  }

  /** Admit a confirmed card answer to this conversation without replacing an unfinished draft. */
  async function respondToCard(text: string, uiResponse?: AgentUiResponse): Promise<boolean> {
    if (busy || !ready || !transcriptReady || !thread || cardResponsePending.current) {
      return false
    }
    cardResponsePending.current = true
    try {
      return await send({ ...context, text, uiResponse })
    } finally {
      cardResponsePending.current = false
    }
  }

  if (!(settingsReady && hydrated)) {
    return (
      <p className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
        <Loader2 className="size-3.5 animate-spin" />
        {t('transcript.promptLoading')}
      </p>
    )
  }
  if (!(messages.length || (ready && transcriptReady) || isChat)) {
    if (transcriptRunning) {
      return (
        <TranscriptPromptWaiting
          armed={armed}
          onArm={() => {
            armPromptIdentity(identity)
            setArmedTick((tick) => tick + 1)
          }}
        />
      )
    }
    return (
      <div className="p-4">
        <TranscriptPromptGuidance errorCode="empty-transcript" />
      </div>
    )
  }
  return (
    <>
      <AgentUiProvider
        activeMessageId={messages.at(-1)?.id}
        disabled={busy || !ready || !transcriptReady}
        respond={respondToCard}
        stop={stop}
      >
        <AgentConversationLayout
          autoScroll={!selecting}
          composer={
            <AgentChatComposer
              attachImagesLabel={t('agentChat.attachImages')}
              attachments={images.map((image) => ({
                id: image.id,
                name: image.name,
                src: agentArtifactUrl(image)
              }))}
              disabled={
                !ready || sending || attaching || Boolean(preview && !preview.admitted) || !thread
              }
              inputRef={composerInput}
              noSkillsLabel={t('download.noItems')}
              onAttachImages={canAttachImages ? () => void selectImages() : undefined}
              onChange={(value) => setDrafts((current) => ({ ...current, [identity]: value }))}
              onPasteImages={canAttachImages ? (files) => void selectImages(files) : undefined}
              onRemoveImage={(id) => void removeImage(id)}
              onSend={() => void submit()}
              onSkillsOpen={() => void refreshSkills()}
              onStop={() => void stop()}
              placeholder={t(standalone ? 'agentChat.newChatPlaceholder' : 'agentChat.placeholder')}
              reasoningControl={
                thinkingOptions && thinkingLevel ? (
                  <AgentReasoningSelect
                    levels={thinkingOptions.levels}
                    onChange={(level) => void setThinkingLevel(level)}
                    onProviderChange={() => void reloadThinkingOptions()}
                    value={thinkingLevel}
                  />
                ) : null
              }
              removeImageLabel={(name) => t('agentChat.removeImage', { name })}
              running={running}
              sendDisabled={imagesUnsupported}
              sendLabel={t('agentChat.send')}
              skills={aiSnapshot?.prompts
                .filter((skill) => !skill.skillError)
                .map((skill) => ({
                  name: skill.name,
                  label: aiPromptLabel(skill, t),
                  description: aiPromptDescription(skill, t)
                }))}
              skillsLabel={`${t('settings.promptsTab')} / ${t('download.video')}`}
              stopLabel={t('transcript.promptStop')}
              value={draft}
              videos={downloads
                .filter((item) => item.type === 'video')
                .map((item) => ({ id: item.id, title: item.title || item.url }))}
            />
          }
          identity={thread?.id ?? identity}
          notice={
            <>
              {error ? (
                <p className="text-destructive text-sm" role="alert">
                  {error}
                </p>
              ) : null}
              {imagesUnsupported ? (
                <p className="text-muted-foreground text-sm" role="status">
                  {t('agentChat.imagesNotSupported')}
                </p>
              ) : null}
            </>
          }
          outputLabel={t('transcript.promptOutput')}
          scrollLabel={t('transcript.promptScrollToEnd')}
          scrollState={
            thread ? (
              <AgentChatScrollState
                leafId={thread.leafId}
                onSelecting={setSelecting}
                threadId={thread.id}
                viewport={viewport}
              />
            ) : null
          }
          viewportRef={viewport}
        >
          {standalone && thread?.messages.length === 0 && !preview ? (
            <MessageScrollerItem className="flex flex-1 items-center" messageId="suggestions">
              <ChatSuggestions disabled={busy || !ready} onSelect={selectSuggestion} />
            </MessageScrollerItem>
          ) : null}
          {presentedThread ? (
            <TranscriptAgentMessages
              busy={busy || !ready || !transcriptReady}
              currentTimeMs={currentTimeMs}
              durationMs={sourceDurationMs}
              messages={presentedMessages}
              onBranch={(id) => void selectBranch(id)}
              onDecideTool={(input) => void decideTool(input)}
              onRetry={(id) => void send({ ...context, retryMessageId: id })}
              onSeek={onSeek}
              onShare={setShareMessageId}
              overviewPrompt={prompt.name === AI_OVERVIEW_PROMPT_ID}
              sendContinuity={
                preview && admittedMessage
                  ? { id: admittedMessage.id, key: preview.message.id }
                  : undefined
              }
              sourceTitle={sourceTitle}
              sourceUrl={sourceUrl}
              thread={presentedThread}
            />
          ) : null}
          {presentedMessages.length || isChat ? null : (
            <MessageScrollerItem messageId="empty">
              <p className="text-muted-foreground">{t('transcript.promptEmpty')}</p>
            </MessageScrollerItem>
          )}
        </AgentConversationLayout>
      </AgentUiProvider>
      <TranscriptShareImageDialog
        fileName={shareImageFileName(sourceTitle)}
        onOpenChange={(open) => {
          if (!open) {
            setShareMessageId(null)
          }
        }}
        open={Boolean(shareMessage)}
        payload={
          shareMessage && thread
            ? {
                coverSrc: sourceCover,
                kind: 'prompt',
                markdown: shareMessage.text,
                promptTitle,
                sourceByline,
                sourceTitle,
                tagline: t('transcript.promptShareTagline'),
                thinkingLabel:
                  (shareMessage.thinkingMs ?? 0) > 0
                    ? thinkingDurationHeader(t, false, shareMessage.thinkingMs ?? 0)
                    : undefined,
                userText: sharePromptUserText(
                  thread?.messages ?? [],
                  shareMessage.id,
                  promptTitle,
                  prompt.name
                ),
                artifacts: artifactsForMessage(
                  thread?.artifacts ?? [],
                  shareMessage.text,
                  selectedAgentMessages({ ...thread, leafId: shareMessage.id }).map(
                    (message) => message.runId
                  )
                ),
                runId: shareMessage.runId ?? undefined
              }
            : null
        }
      />
    </>
  )
}
