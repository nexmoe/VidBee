import { Button } from '@renderer/components/ui/button'
import { MessageScrollerItem } from '@renderer/components/ui/message-scroller'
import { useAgentChat } from '@renderer/hooks/use-agent-chat'
import { shareImageFileName } from '@renderer/lib/capture-prompt-share'
import { trackDesktopEvent } from '@renderer/lib/desktop-analytics'
import { thinkingDurationHeader } from '@renderer/lib/thinking-header'
import {
  AGENT_MAX_MESSAGE_IMAGES,
  draftAgentImages,
  selectedAgentMessages
} from '@shared/agent-chat'
import { artifactsForMessage } from '@shared/agent-markdown'
import { AI_CHAT_PROMPT_ID, AI_OVERVIEW_PROMPT_ID } from '@shared/ai-prompts'
import type { AiPrompt } from '@shared/ai-types'
import { sharePromptUserText } from '@shared/types/share-card'
import { AgentChatComposer } from '@vidbee/ui/components/agent-chat-composer'
import { AgentConversationLayout } from '@vidbee/ui/components/agent-workspace'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AgentChatScrollState } from './AgentChatScrollState'
import { AgentReasoningSelect } from './AgentReasoningSelect'
import { agentArtifactUrl } from './AgentResponseContent'
import { TranscriptAgentMessages } from './TranscriptAgentMessageRow'
import { TranscriptPromptGuidance } from './TranscriptPromptGuidance'
import { TranscriptShareImageDialog } from './TranscriptShareImageDialog'

interface TranscriptPromptPaneProps {
  downloadId: string
  hasProvider: boolean
  prompt: AiPrompt
  /** Open this conversation instead of the prompt's get-or-create thread. */
  threadId?: string | null
  ready: boolean
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
  transcriptText: string
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

/** Persistent per-video agent conversation; navigation never owns the runtime lifetime. */
export function TranscriptPromptPane({
  downloadId,
  hasProvider,
  prompt,
  threadId = null,
  ready,
  settingsReady,
  onSeek,
  currentTimeMs = 0,
  sourceCover,
  sourceByline,
  sourceTitle,
  sourceUrl,
  sourceDurationMs = 0,
  transcriptRunning = false,
  transcriptText,
  hasStoredTranscript = false
}: TranscriptPromptPaneProps) {
  const { t, i18n } = useTranslation()
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
  } = useAgentChat(downloadId, prompt.id, threadId)
  const identity = threadId || `${downloadId}:${prompt.id}`
  const isChat = prompt.id === AI_CHAT_PROMPT_ID
  const autoStarted = useRef(new Set<string>())
  const [, setArmedTick] = useState(0)
  const armed = armedPromptIdentities.has(identity)
  const preferredThinkingLevel = thread?.thinkingLevel
  const thinkingLevel =
    preferredThinkingLevel && thinkingOptions?.levels.includes(preferredThinkingLevel)
      ? preferredThinkingLevel
      : thinkingOptions?.defaultLevel
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [shareMessageId, setShareMessageId] = useState<string | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [selecting, setSelecting] = useState(false)
  const draft = drafts[identity] ?? ''
  const messages = thread ? selectedAgentMessages(thread) : []
  const images = thread ? draftAgentImages(thread) : []
  const imagesUnsupported = images.length > 0 && !thinkingOptions?.vision
  const running = thread?.runs.some((run) => run.status === 'running') ?? false
  const busy = running || sending || attaching
  const promptTitle = prompt.isPreset
    ? t(`settings.ai.presetPrompts.${prompt.id}.title`)
    : prompt.title
  const shareMessage = messages.find((message) => message.id === shareMessageId)
  const transcriptReady = hasStoredTranscript || Boolean(transcriptText.trim())
  const context = {
    thinkingLevel,
    ...(hasStoredTranscript ? {} : { transcriptText }),
    uiLanguage: i18n.language,
    sourceTitle: sourceTitle ?? undefined,
    sourceDurationMs
  }
  const latestRun = thread?.runs.at(-1)

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

  /** Keep drafts until the main process has durably admitted the message. */
  async function submit(): Promise<void> {
    if (busy || imagesUnsupported || !(draft.trim() || images.length)) {
      return
    }
    if (
      await send({
        ...context,
        text: draft,
        ...(images.length ? { imageIds: images.map((image) => image.id) } : {})
      })
    ) {
      setDrafts((current) => ({
        ...current,
        [identity]: current[identity] === draft ? '' : current[identity]
      }))
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
            disabled={!ready || sending || attaching || !thread}
            onAttachImages={
              thinkingOptions?.vision && images.length < AGENT_MAX_MESSAGE_IMAGES
                ? () => void selectImages()
                : undefined
            }
            onChange={(value) => setDrafts((current) => ({ ...current, [identity]: value }))}
            onRemoveImage={(id) => void removeImage(id)}
            onSend={() => void submit()}
            onStop={() => void stop()}
            placeholder={t('agentChat.placeholder')}
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
            stopLabel={t('transcript.promptStop')}
            value={draft}
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
        {thread ? (
          <TranscriptAgentMessages
            busy={busy || !ready || !transcriptReady}
            currentTimeMs={currentTimeMs}
            durationMs={sourceDurationMs}
            messages={messages}
            onBranch={(id) => void selectBranch(id)}
            onDecideTool={(input) => void decideTool(input)}
            onRetry={(id) => void send({ ...context, retryMessageId: id })}
            onSeek={onSeek}
            onShare={setShareMessageId}
            overviewPrompt={prompt.id === AI_OVERVIEW_PROMPT_ID}
            sourceTitle={sourceTitle}
            sourceUrl={sourceUrl}
            thread={thread}
          />
        ) : null}
        {messages.length || isChat ? null : (
          <MessageScrollerItem messageId="empty">
            <p className="text-muted-foreground">{t('transcript.promptEmpty')}</p>
          </MessageScrollerItem>
        )}
      </AgentConversationLayout>
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
                  prompt.title
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
