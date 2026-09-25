import { Button } from '@renderer/components/ui/button'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@renderer/components/ui/message-scroller'
import { useAgentChat } from '@renderer/hooks/use-agent-chat'
import { shareImageFileName } from '@renderer/lib/capture-prompt-share'
import { trackDesktopEvent } from '@renderer/lib/rybbit-client'
import {
  AGENT_MAX_MESSAGE_IMAGES,
  type AgentThinkingLevel,
  draftAgentImages,
  selectedAgentMessages
} from '@shared/agent-chat'
import { artifactsForMessage } from '@shared/agent-markdown'
import { AI_CHAT_PROMPT_ID, AI_OVERVIEW_PROMPT_ID } from '@shared/ai-prompts'
import type { AiPrompt } from '@shared/ai-types'
import { sharePromptUserText } from '@shared/types/share-card'
import { AgentChatComposer } from '@vidbee/ui/components/agent-chat-composer'
import { ArrowDown, Loader2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AgentChatMessageView } from './AgentChatMessageView'
import { AgentChatScrollState } from './AgentChatScrollState'
import { AgentReasoningSelect } from './AgentReasoningSelect'
import { agentArtifactUrl } from './AgentResponseContent'
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

/** Keep list padding in step with the floating composer height. */
function syncComposerDockHeight(pane: HTMLElement, composer: HTMLElement): void {
  pane.style.setProperty('--agent-composer-height', `${composer.getBoundingClientRect().height}px`)
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
    selectImages,
    removeImage
  } = useAgentChat(downloadId, prompt.id, threadId)
  const identity = threadId || `${downloadId}:${prompt.id}`
  const isChat = prompt.id === AI_CHAT_PROMPT_ID
  const autoStarted = useRef(new Set<string>())
  const [armedIdentity, setArmedIdentity] = useState<string | null>(null)
  const [thinkingLevels, setThinkingLevels] = useState<Record<string, AgentThinkingLevel>>({})
  const preferredThinkingLevel = thinkingLevels[identity]
  const thinkingLevel =
    preferredThinkingLevel && thinkingOptions?.levels.includes(preferredThinkingLevel)
      ? preferredThinkingLevel
      : thinkingOptions?.defaultLevel
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [shareMessageId, setShareMessageId] = useState<string | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
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
    if (transcriptRunning && armedIdentity !== identity) {
      return
    }
    autoStarted.current.add(identity)
    void send({
      thinkingLevel,
      ...(hasStoredTranscript ? {} : { transcriptText }),
      uiLanguage: i18n.language,
      sourceTitle: sourceTitle ?? undefined,
      sourceDurationMs
    })
  }, [
    armedIdentity,
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

  useLayoutEffect(() => {
    const pane = paneRef.current
    const composer = composerRef.current
    if (!(pane && composer)) {
      return
    }
    const sync = (): void => {
      syncComposerDockHeight(pane, composer)
    }
    sync()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(sync)
    observer.observe(composer)
    return () => {
      observer.disconnect()
      pane.style.removeProperty('--agent-composer-height')
    }
  }, [])

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
          armed={armedIdentity === identity}
          onArm={() => setArmedIdentity(identity)}
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
    <div
      className="relative flex h-full min-h-0 flex-col [--agent-composer-inset:0.75rem]"
      ref={paneRef}
    >
      {/* last-anchor + user scrollAnchor pins the turn start; long streamed
          replies often already overflow, so live-edge follow never starts. */}
      <MessageScrollerProvider
        autoScroll={!selecting}
        defaultScrollPosition="end"
        key={thread?.id ?? identity}
        scrollEdgeThreshold={32}
      >
        <MessageScroller className="min-h-0 flex-1" data-testid="transcript-prompt-output">
          <MessageScrollerViewport aria-label={t('transcript.promptOutput')} ref={viewport}>
            <MessageScrollerContent className="gap-6 px-5 pt-5 pb-[calc(var(--agent-composer-height,44px)+var(--agent-composer-inset)+1rem)] text-sm leading-relaxed">
              {thread
                ? messages.map((message, index) => (
                    <MessageScrollerItem key={message.id} messageId={message.id}>
                      <AgentChatMessageView
                        busy={busy || !ready || !transcriptReady}
                        currentTimeMs={currentTimeMs}
                        durationMs={sourceDurationMs}
                        message={message}
                        onBranch={(id) => void selectBranch(id)}
                        onDecideTool={(input) => void decideTool(input)}
                        onRetry={(id) => void send({ ...context, retryMessageId: id })}
                        onSeek={onSeek}
                        onShare={setShareMessageId}
                        overview={prompt.id === AI_OVERVIEW_PROMPT_ID && index <= 1}
                        sourceTitle={sourceTitle}
                        thread={thread}
                      />
                    </MessageScrollerItem>
                  ))
                : null}
              {messages.length || isChat ? null : (
                <MessageScrollerItem messageId="empty">
                  <p className="text-muted-foreground">{t('transcript.promptEmpty')}</p>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton className="data-[direction=end]:bottom-[calc(var(--agent-composer-height,44px)+var(--agent-composer-inset)+0.25rem)]">
            <ArrowDown />
            <span className="sr-only">{t('transcript.promptScrollToEnd')}</span>
          </MessageScrollerButton>
        </MessageScroller>
        {thread ? (
          <AgentChatScrollState
            leafId={thread.leafId}
            onSelecting={setSelecting}
            threadId={thread.id}
            viewport={viewport}
          />
        ) : null}
      </MessageScrollerProvider>
      <div
        className="pointer-events-none absolute inset-x-[var(--agent-composer-inset)] bottom-[var(--agent-composer-inset)] z-20"
        data-testid="agent-chat-composer-dock"
      >
        {error ? (
          <p className="pointer-events-auto pb-2 text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {imagesUnsupported ? (
          <p className="pointer-events-auto pb-2 text-muted-foreground text-sm" role="status">
            {t('agentChat.imagesNotSupported')}
          </p>
        ) : null}
        <div className="pointer-events-auto" ref={composerRef}>
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
                  onChange={(level) =>
                    setThinkingLevels((current) => ({ ...current, [identity]: level }))
                  }
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
        </div>
      </div>
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
    </div>
  )
}
