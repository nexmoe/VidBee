import { AiPromptIcon } from '@renderer/components/settings/ai-prompt-icon'
import { TabUnderline } from '@renderer/components/transcript/TabUnderline'
import { TranscriptCaptionsPane } from '@renderer/components/transcript/TranscriptCaptionsPane'
import { TranscriptPromptHistory } from '@renderer/components/transcript/TranscriptPromptHistory'
import { TranscriptPromptPane } from '@renderer/components/transcript/TranscriptPromptPane'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { usePromptRunStatuses } from '@renderer/hooks/use-prompt-run'
import { ipcEvents, ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import { prefersReducedMotion } from '@renderer/lib/transcript-follow'
import { findTranscriptTab, scrollTranscriptTabIntoView } from '@renderer/lib/transcript-tab-scroll'
import {
  startTypedViewTransition,
  TRANSCRIPT_VT_TAB
} from '@renderer/lib/transcript-view-transition'
import { cn } from '@renderer/lib/utils'
import { pendingPromptTabAtom } from '@renderer/store/transcript-prompt-tab'
import type { TranscriptSegmentView, TranscriptSpeakerView } from '@renderer/store/transcripts'
import type { AgentRunEvent, AgentThreadSummary } from '@shared/agent-chat'
import { buildOverviewPromptTranscriptText } from '@shared/ai-prompt-text'
import {
  AI_CHAT_PROMPT_ID,
  AI_OVERVIEW_PROMPT_ID,
  agentChatPrompt,
  partitionTranscriptPromptTabs
} from '@shared/ai-prompts'
import { promptTabIndicator } from '@shared/ai-run'
import type {
  AiPrompt,
  AiPromptIconId,
  AiPromptRunStatus,
  AiSettingsSnapshot
} from '@shared/ai-types'
import { useAtom } from 'jotai'
import { Captions, Check, ChevronDown, History, MessageCircle, Plus, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface TranscriptSidePanelProps {
  collapsed: boolean
  currentSegmentId: string | null
  currentTimeMs: number
  downloadId: string
  /** Worker/task error text when local ASR failed. */
  error?: string | null
  /** Local ASR ended in a failed task state. */
  failed?: boolean
  noSpeech: boolean
  noSpeechDetail: string
  /** Stop an in-flight local ASR run. */
  onCancel?: () => void
  /** Retry a failed local ASR run. */
  onRetry?: () => void
  /** Open another video's transcript from conversation history. */
  onOpenDownload?: (
    downloadId: string,
    conversation?: { promptId: string; threadId?: string }
  ) => void
  /** Persist the visible tab on the transcript route. */
  onRouteTabChange?: (tab: string, threadId: string | null) => void
  /** Active conversation id from the transcript route search. */
  routeTab?: string
  /** Chat thread id from the transcript route search. */
  routeThreadId?: string
  onSeek: (seconds: number) => void
  /** Start local ASR from the idle empty state. */
  onStart?: () => void
  /**
   * Whether AI prompts may run. False during first-pass ASR even if live
   * lines are already on screen. Speaker overlay of a finished transcript
   * stays true so existing prompt results remain reachable.
   */
  promptsReady?: boolean
  ready: boolean
  resolveColorIndex: (speakerId: string | null) => number | null
  resolveSpeaker: (speakerId: string | null) => string
  running: boolean
  runningLabel: string
  /** Live transcription pipeline stage from the worker. */
  stage?: string | null
  /** Persisted stage timings so the clock survives navigation and restarts. */
  stageHistory?: Array<{ stage: string; startedAt: number }>
  segments: TranscriptSegmentView[]
  /** Speakers used when relabeling a caption. */
  speakers?: TranscriptSpeakerView[]
  /** Cached local cover URL printed on the share card. */
  sourceCover?: string | null
  /** Media duration for the share-card progress bar. */
  sourceDurationMs?: number
  /** Platform and channel printed under the share card title. */
  sourceByline?: string
  /** Media title printed on the share card header. */
  sourceTitle?: string
  /** Public video URL used as the Cloud cache identity. */
  sourceUrl?: string | null
  /** ISO 639 / BCP-47 language of the visible captions. */
  transcriptLanguage?: string | null
  /** Whether these captions came from ASR / platform-auto or a human track. */
  transcriptOrigin?: 'ai' | 'human'
  /** Typewriter incoming ASR lines. Off when viewing a finished caption track. */
  streamLive?: boolean
  transcriptText: string
  /** True when Desktop already has a stored transcript record. */
  hasStoredTranscript?: boolean
}

/**
 * Translate a built-in prompt title, falling back to the stored English title.
 *
 * @param prompt Prompt record.
 * @param t i18n function.
 */
const promptLabel = (prompt: AiPrompt, t: (key: string) => string): string =>
  prompt.isPreset ? t(`settings.ai.presetPrompts.${prompt.id}.title`) : prompt.title

const PROMPT_MENU_ITEM_CLASS =
  'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors duration-200 hover:bg-accent hover:text-accent-foreground'

const TAB_STATUS_DOT_CLASS = {
  completed: 'bg-emerald-500',
  error: 'bg-red-500',
  running: 'bg-primary'
} as const

const TAB_STATUS_LABEL_KEY = {
  completed: 'transcript.promptTabCompleted',
  error: 'transcript.promptTabError',
  running: 'transcript.promptRunning'
} as const

const TAB_BUTTON_CLASS =
  'inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap border-transparent border-b-2 px-2 py-2.5 font-medium text-sm transition-colors duration-200'

const MENU_HOVER_CLOSE_MS = 120

/**
 * Colored status mark for a prompt tab. Running uses a ping so live work stays visible.
 *
 * @param props.promptId Prompt id used in test ids.
 * @param props.status Latest run status, or undefined before the first fetch.
 * @param props.viewed True when the current completed/error result has been opened.
 */
function PromptTabStatus({
  promptId,
  status,
  viewed = false
}: {
  promptId: string
  status: AiPromptRunStatus | undefined
  viewed?: boolean
}) {
  const { t } = useTranslation()
  const indicator = status ? promptTabIndicator(status, viewed) : null
  if (!indicator) {
    return null
  }
  return (
    <span
      aria-hidden
      className="relative inline-flex size-1.5 shrink-0"
      data-status={indicator}
      data-testid={`prompt-tab-status-${promptId}`}
      title={t(TAB_STATUS_LABEL_KEY[indicator])}
    >
      {indicator === 'running' ? (
        <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-60 motion-reduce:hidden" />
      ) : null}
      <span
        className={cn('relative block size-1.5 rounded-full', TAB_STATUS_DOT_CLASS[indicator])}
      />
    </span>
  )
}

/**
 * Whether a completed or failed prompt result has already been opened.
 *
 * @param downloadId Current transcript id.
 * @param promptId Prompt tab id.
 * @param tab Active tab id.
 * @param updatedAt Run timestamp, if any.
 * @param viewedAt Opened-run timestamps by download and prompt.
 */
function isPromptTabViewed(
  downloadId: string,
  promptId: string,
  tab: string,
  updatedAt: number | undefined,
  viewedAt: Record<string, number>
): boolean {
  return tab === promptId || viewedAt[`${downloadId}:${promptId}`] === updatedAt
}

/**
 * One prompt chip in the transcript tab bar.
 *
 * @param props.active Whether this chip is the current tab.
 * @param props.icon Optional leading icon shown beside the label.
 * @param props.label Visible tab label.
 * @param props.onSelect Activate this tab.
 * @param props.promptId Prompt id used as `data-tab-id`.
 * @param props.status Latest run status for that prompt.
 * @param props.viewed True when the current completed/error result has been opened.
 */
function PromptTabButton({
  active,
  icon,
  label,
  onClose,
  onSelect,
  promptId,
  status,
  viewed
}: {
  active: boolean
  icon?: AiPromptIconId
  label: string
  onClose?: () => void
  onSelect: () => void
  promptId: string
  status?: AiPromptRunStatus
  viewed: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="relative inline-flex items-end" data-tab-id={promptId}>
      <button
        className={cn(
          TAB_BUTTON_CLASS,
          onClose && 'pr-6',
          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
        )}
        onClick={onSelect}
        type="button"
      >
        {icon ? <AiPromptIcon icon={icon} /> : null}
        <span className="max-w-40 truncate">{label}</span>
        <PromptTabStatus promptId={promptId} status={status} viewed={viewed} />
      </button>
      {onClose ? (
        <button
          aria-label={t('transcript.promptTabClose')}
          className="absolute top-1/2 right-0.5 inline-flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          data-testid={`transcript-prompt-tab-close-${promptId}`}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }}
          type="button"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  )
}

/**
 * One row in the overflow prompt menu.
 *
 * @param props.active Whether this row is the current tab.
 * @param props.icon Leading icon shown beside the label.
 * @param props.label Visible label.
 * @param props.onSelect Activate this tab.
 * @param props.promptId Prompt id when this row is a prompt tab.
 * @param props.status Latest run status for that prompt.
 * @param props.viewed True when the current completed/error result has been opened.
 */
function PromptMenuItem({
  active,
  icon,
  label,
  onSelect,
  promptId,
  status,
  viewed = false
}: {
  active: boolean
  icon: ReactNode
  label: string
  onSelect: () => void
  promptId?: string
  status?: AiPromptRunStatus
  viewed?: boolean
}) {
  return (
    <DropdownMenuItem className={PROMPT_MENU_ITEM_CLASS} onSelect={onSelect}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {promptId ? (
        <PromptTabStatus promptId={`menu-${promptId}`} status={status} viewed={viewed} />
      ) : null}
      {active ? <Check className="size-3.5 shrink-0" /> : null}
    </DropdownMenuItem>
  )
}

/**
 * Transcript captions plus a tab for each enabled prompt.
 */
export function TranscriptSidePanel({
  collapsed,
  currentSegmentId,
  currentTimeMs,
  downloadId,
  error = null,
  failed = false,
  noSpeech,
  noSpeechDetail,
  onCancel,
  onRetry,
  onOpenDownload,
  onRouteTabChange,
  onSeek,
  onStart,
  promptsReady,
  ready,
  resolveColorIndex,
  resolveSpeaker,
  routeTab,
  routeThreadId,
  running,
  runningLabel,
  stage = null,
  stageHistory = [],
  segments,
  speakers,
  sourceCover,
  sourceDurationMs,
  sourceByline,
  sourceTitle,
  sourceUrl,
  streamLive = running,
  transcriptLanguage,
  transcriptOrigin,
  transcriptText,
  hasStoredTranscript = false
}: TranscriptSidePanelProps) {
  const { t } = useTranslation()
  const [pendingTab, setPendingTab] = useAtom(pendingPromptTabAtom)
  const tabsRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [snapshot, setSnapshot] = useState<AiSettingsSnapshot | null>(null)
  const [tab, setTab] = useState(routeTab ?? 'transcript')
  const [threadId, setThreadId] = useState<string | null>(routeThreadId ?? null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [videoThreads, setVideoThreads] = useState<AgentThreadSummary[]>([])
  const [openChatIdsByVideo, setOpenChatIdsByVideo] = useState<Record<string, string[]>>(() =>
    routeTab === AI_CHAT_PROMPT_ID && routeThreadId ? { [downloadId]: [routeThreadId] } : {}
  )
  const [viewedAt, setViewedAt] = useState<Record<string, number>>({})
  const tabsViewportRef = useRef<HTMLDivElement>(null)
  const scrolledDownloadIdRef = useRef(downloadId)
  const scrolledTabIdRef = useRef<string | null>(null)
  const canUsePrompts = promptsReady ?? !running

  /**
   * Load enabled prompts and the active provider.
   */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      setSnapshot(await ipcServices.ai.getSnapshot())
    } catch (error) {
      logger.error('Failed to load AI prompts for transcript', error)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Cancel a pending hover-close so the pointer can move onto the menu.
   */
  const cancelCloseMenu = useCallback((): void => {
    if (closeTimerRef.current === null) {
      return
    }
    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  /**
   * Open the overflow prompt menu.
   */
  const openMenu = useCallback((): void => {
    cancelCloseMenu()
    setMenuOpen(true)
  }, [cancelCloseMenu])

  /**
   * Close the overflow prompt menu.
   */
  const closeMenu = useCallback((): void => {
    cancelCloseMenu()
    setMenuOpen(false)
  }, [cancelCloseMenu])

  /**
   * Close shortly after leave so the pointer can cross into the menu.
   */
  const scheduleCloseMenu = useCallback((): void => {
    cancelCloseMenu()
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      setMenuOpen(false)
    }, MENU_HOVER_CLOSE_MS)
  }, [cancelCloseMenu])

  /**
   * Switch the visible conversation, close menus, and keep the chip in view.
   *
   * @param id Transcript tab, prompt id, or blank-chat id.
   * @param nextThreadId Specific thread from history or New chat; omitted for prompt tabs.
   */
  const selectConversation = useCallback(
    (id: string, nextThreadId: string | null = null): void => {
      if (id === tab && nextThreadId === threadId) {
        closeMenu()
        setHistoryOpen(false)
        return
      }
      startTypedViewTransition(() => {
        const nextThread = id === 'transcript' ? null : nextThreadId
        setTab(id)
        setThreadId(nextThread)
        closeMenu()
        setHistoryOpen(false)
        onRouteTabChange?.(id, nextThread)
      }, [TRANSCRIPT_VT_TAB])
    },
    [closeMenu, onRouteTabChange, tab, threadId]
  )

  /**
   * Keep a chat thread visible on the tab bar without deleting it.
   *
   * @param id Thread to show.
   */
  const openChatTab = useCallback(
    (id: string): void => {
      setOpenChatIdsByVideo((current) => {
        const open = current[downloadId] ?? []
        if (open.includes(id)) {
          return current
        }
        return { ...current, [downloadId]: [...open, id] }
      })
    },
    [downloadId]
  )

  /**
   * Hide a chat tab. The conversation stays in history.
   *
   * @param id Thread to hide.
   */
  const closeChatTab = useCallback(
    (id: string): void => {
      setOpenChatIdsByVideo((current) => ({
        ...current,
        [downloadId]: (current[downloadId] ?? []).filter((entry) => entry !== id)
      }))
      if (threadId === id) {
        selectConversation('transcript', null)
      }
    },
    [downloadId, selectConversation, threadId]
  )

  /**
   * Switch tab, close the overflow menu, and keep the chip in view.
   *
   * @param id Transcript tab or prompt id.
   */
  const selectTab = useCallback(
    (id: string): void => {
      selectConversation(id, null)
    },
    [selectConversation]
  )

  /**
   * Open a history conversation: switch prompt on this video, or navigate to another.
   *
   * @param item History row that was chosen.
   */
  const openHistoryItem = useCallback(
    (item: AgentThreadSummary): void => {
      setHistoryOpen(false)
      if (item.promptId === AI_CHAT_PROMPT_ID) {
        openChatTab(item.id)
      }
      if (item.downloadId === downloadId) {
        selectConversation(item.promptId, item.id)
        return
      }
      setPendingTab({
        downloadId: item.downloadId,
        promptId: item.promptId,
        threadId: item.id
      })
      onOpenDownload?.(item.downloadId, { promptId: item.promptId, threadId: item.id })
    },
    [downloadId, onOpenDownload, openChatTab, selectConversation, setPendingTab]
  )

  /**
   * Leave a deleted conversation so the prompt tab does not recreate and auto-run it.
   *
   * @param item Conversation that was removed.
   */
  const onHistoryDeleted = useCallback(
    (item: AgentThreadSummary): void => {
      setVideoThreads((current) => current.filter((thread) => thread.id !== item.id))
      setOpenChatIdsByVideo((current) => ({
        ...current,
        [downloadId]: (current[downloadId] ?? []).filter((id) => id !== item.id)
      }))
      if (
        item.id === threadId ||
        (item.downloadId === downloadId && item.promptId === tab && !threadId)
      ) {
        selectConversation('transcript', null)
      }
    },
    [downloadId, selectConversation, tab, threadId]
  )

  /**
   * Reload this video's conversations so new chats stay on the tab bar.
   */
  const refreshVideoThreads = useCallback(async (): Promise<void> => {
    try {
      setVideoThreads(await ipcServices.ai.listAgentThreads({ downloadId }))
    } catch (error) {
      logger.error('Failed to load video conversations', error)
    }
  }, [downloadId])

  /**
   * Start a blank Agent chat on this video.
   */
  const startNewChat = useCallback(async (): Promise<void> => {
    try {
      const thread = await ipcServices.ai.createAgentThread({ downloadId })
      await refreshVideoThreads()
      openChatTab(thread.id)
      selectConversation(AI_CHAT_PROMPT_ID, thread.id)
    } catch (error) {
      logger.error('Failed to start a new chat', error)
    }
  }, [downloadId, openChatTab, refreshVideoThreads, selectConversation])

  useEffect(() => {
    if (!onRouteTabChange) {
      return
    }
    const nextTab = routeTab ?? 'transcript'
    const nextThread = routeThreadId ?? null
    setTab((current) => (current === nextTab ? current : nextTab))
    setThreadId((current) => (current === nextThread ? current : nextThread))
    if (nextTab === AI_CHAT_PROMPT_ID && nextThread) {
      openChatTab(nextThread)
    }
  }, [onRouteTabChange, openChatTab, routeTab, routeThreadId])

  useEffect(() => {
    if (!pendingTab || pendingTab.downloadId !== downloadId) {
      return
    }
    if (pendingTab.promptId === AI_CHAT_PROMPT_ID && pendingTab.threadId) {
      openChatTab(pendingTab.threadId)
    }
    selectConversation(pendingTab.promptId, pendingTab.threadId ?? null)
    setPendingTab(null)
  }, [downloadId, openChatTab, pendingTab, selectConversation, setPendingTab])

  useEffect(() => {
    void refreshVideoThreads()
    const listener = ipcEvents.on('ai:agent-event', (...args: unknown[]) => {
      const event = args[0] as AgentRunEvent
      if (event?.snapshot?.downloadId === downloadId) {
        void refreshVideoThreads()
      }
    })
    return () => {
      ipcEvents.removeListener('ai:agent-event', listener)
    }
  }, [downloadId, refreshVideoThreads])

  const activeTabPresent =
    tab === 'transcript' ||
    Boolean(snapshot?.prompts.some((prompt) => prompt.id === tab)) ||
    Boolean(threadId && videoThreads.some((thread) => thread.id === threadId))

  useLayoutEffect(() => {
    if (collapsed || !activeTabPresent) {
      return
    }
    const viewport = tabsViewportRef.current
    const list = tabsRef.current
    if (!(viewport && list)) {
      return
    }
    if (scrolledDownloadIdRef.current !== downloadId) {
      scrolledDownloadIdRef.current = downloadId
      scrolledTabIdRef.current = null
    }
    const activeId = threadId ?? tab
    const activeTab = findTranscriptTab(list, activeId)
    if (!activeTab) {
      return
    }
    const behavior =
      prefersReducedMotion() ||
      scrolledTabIdRef.current === null ||
      scrolledTabIdRef.current === activeId
        ? 'auto'
        : 'smooth'
    scrolledTabIdRef.current = activeId
    scrollTranscriptTabIntoView(viewport, activeTab, behavior)
  }, [activeTabPresent, collapsed, downloadId, tab, threadId])

  /**
   * Keep hover and Radix dismiss (Escape, click-outside, item select) in sync.
   */
  const onMenuOpenChange = useCallback(
    (open: boolean): void => {
      if (open) {
        openMenu()
        return
      }
      closeMenu()
    },
    [closeMenu, openMenu]
  )

  useEffect(() => {
    return () => {
      cancelCloseMenu()
    }
  }, [cancelCloseMenu])

  const allPrompts = snapshot?.prompts ?? []
  const prompts = allPrompts.filter((prompt) => prompt.enabled)
  const { overview, rest: otherPrompts } = partitionTranscriptPromptTabs(prompts)
  const runStatuses = usePromptRunStatuses(
    downloadId,
    prompts.map((prompt) => prompt.id)
  )

  useEffect(() => {
    if (tab === 'transcript') {
      return
    }
    const run = runStatuses[tab]
    if (run?.status !== 'completed' && run?.status !== 'error') {
      return
    }
    setViewedAt((prev) => {
      const key = `${downloadId}:${tab}`
      return prev[key] === run.updatedAt ? prev : { ...prev, [key]: run.updatedAt }
    })
  }, [downloadId, runStatuses, tab])

  if (collapsed) {
    return null
  }

  const openChatIds = openChatIdsByVideo[downloadId] ?? []
  const chatThreads = openChatIds
    .map((id) =>
      videoThreads.find((thread) => thread.id === id && thread.promptId === AI_CHAT_PROMPT_ID)
    )
    .filter((thread): thread is AgentThreadSummary => Boolean(thread))
  const storedPrompt = allPrompts.find((prompt) => prompt.id === tab) ?? null
  const activePrompt =
    tab === 'transcript'
      ? null
      : (storedPrompt ?? (tab === AI_CHAT_PROMPT_ID || threadId ? agentChatPrompt() : null))
  const settingsReady = snapshot !== null
  const hasProvider = Boolean(snapshot?.activeProviderId)
  const promptTranscriptText =
    activePrompt?.id === AI_OVERVIEW_PROMPT_ID
      ? buildOverviewPromptTranscriptText(segments, resolveSpeaker, {
          durationMs: sourceDurationMs,
          title: sourceTitle
        })
      : transcriptText
  return (
    <div className="relative flex h-full min-h-0 flex-col border-border/60 border-t bg-background lg:border-t-0 lg:border-l">
      <div className="relative z-20 shrink-0 border-border/60 border-b">
        <ScrollArea
          className={cn(
            'w-full px-4',
            prompts.length > 0 || chatThreads.length > 0 ? 'pr-28' : 'pr-20'
          )}
          orientation="horizontal"
          viewportClassName="h-auto overflow-y-hidden"
          viewportRef={tabsViewportRef}
        >
          <div
            className="relative flex min-w-max items-end"
            data-testid="transcript-prompt-tabs"
            ref={tabsRef}
          >
            <TabUnderline activeId={threadId ?? tab} />
            <button
              className={cn(
                TAB_BUTTON_CLASS,
                tab === 'transcript'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              data-tab-id="transcript"
              onClick={() => selectTab('transcript')}
              type="button"
            >
              <Captions aria-hidden className="size-4" />
              {t('transcript.title')}
            </button>
            {overview ? (
              <PromptTabButton
                active={tab === overview.id}
                icon={overview.icon}
                label={promptLabel(overview, t)}
                onSelect={() => selectTab(overview.id)}
                promptId={overview.id}
                status={runStatuses[overview.id]?.status}
                viewed={isPromptTabViewed(
                  downloadId,
                  overview.id,
                  tab,
                  runStatuses[overview.id]?.updatedAt,
                  viewedAt
                )}
              />
            ) : null}
            {otherPrompts.length > 0 ? (
              <span aria-hidden className="mx-1.5 mb-3 h-3.5 w-px shrink-0 bg-border" />
            ) : null}
            {otherPrompts.map((prompt) => (
              <PromptTabButton
                active={tab === prompt.id}
                key={prompt.id}
                label={promptLabel(prompt, t)}
                onSelect={() => selectTab(prompt.id)}
                promptId={prompt.id}
                status={runStatuses[prompt.id]?.status}
                viewed={isPromptTabViewed(
                  downloadId,
                  prompt.id,
                  tab,
                  runStatuses[prompt.id]?.updatedAt,
                  viewedAt
                )}
              />
            ))}
            {chatThreads.map((thread) => (
              <PromptTabButton
                active={threadId === thread.id}
                key={thread.id}
                label={thread.title.trim() || t('transcript.promptHistoryChat')}
                onClose={() => closeChatTab(thread.id)}
                onSelect={() => selectConversation(AI_CHAT_PROMPT_ID, thread.id)}
                promptId={thread.id}
                status={thread.running ? 'running' : undefined}
                viewed
              />
            ))}
          </div>
        </ScrollArea>
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-stretch bg-gradient-to-l from-40% from-background to-transparent pl-6">
          <button
            aria-label={t('transcript.promptHistoryNew')}
            className="pointer-events-auto inline-flex h-full w-9 cursor-pointer items-center justify-center text-muted-foreground transition-colors duration-200 hover:bg-muted/70 hover:text-foreground"
            data-testid="transcript-prompt-new-chat"
            onClick={() => {
              closeMenu()
              void startNewChat()
            }}
            type="button"
          >
            <Plus className="size-4" />
          </button>
          <button
            aria-expanded={historyOpen}
            aria-label={
              historyOpen ? t('transcript.promptHistoryClose') : t('transcript.promptHistory')
            }
            className={cn(
              'pointer-events-auto inline-flex h-full w-9 cursor-pointer items-center justify-center transition-colors duration-200 hover:bg-muted/70 hover:text-foreground',
              historyOpen ? 'bg-muted/70 text-foreground' : 'text-muted-foreground'
            )}
            data-testid="transcript-prompt-history"
            onClick={() => {
              closeMenu()
              setHistoryOpen((current) => !current)
            }}
            type="button"
          >
            <History className="size-4" />
          </button>
          {prompts.length > 0 || chatThreads.length > 0 ? (
            <div className="pointer-events-auto flex h-full items-stretch">
              <DropdownMenu modal={false} onOpenChange={onMenuOpenChange} open={menuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label={t('transcript.promptMenu')}
                    className="inline-flex h-full w-9 cursor-pointer items-center justify-center text-muted-foreground transition-colors duration-200 hover:bg-muted/70 hover:text-foreground"
                    data-testid="transcript-prompt-menu"
                    onFocus={openMenu}
                    onMouseEnter={openMenu}
                    onMouseLeave={scheduleCloseMenu}
                    onPointerDown={(event) => event.preventDefault()}
                    type="button"
                  >
                    <ChevronDown
                      className={cn(
                        'size-4 transition-transform duration-200',
                        menuOpen && 'rotate-180'
                      )}
                    />
                  </button>
                </DropdownMenuTrigger>
                {/* Portaled: in-pane z-index is trapped by the view-transition stacking context. */}
                <DropdownMenuContent
                  align="end"
                  className="z-[80] max-h-72 min-w-52"
                  data-testid="transcript-prompt-menu-list"
                  onCloseAutoFocus={(event) => event.preventDefault()}
                  onMouseEnter={openMenu}
                  onMouseLeave={scheduleCloseMenu}
                  sideOffset={4}
                >
                  <PromptMenuItem
                    active={tab === 'transcript'}
                    icon={<Captions aria-hidden className="size-4 shrink-0" />}
                    label={t('transcript.title')}
                    onSelect={() => selectTab('transcript')}
                  />
                  {overview ? (
                    <PromptMenuItem
                      active={tab === overview.id}
                      icon={<AiPromptIcon className="size-4 shrink-0" icon={overview.icon} />}
                      label={promptLabel(overview, t)}
                      onSelect={() => selectTab(overview.id)}
                      promptId={overview.id}
                      status={runStatuses[overview.id]?.status}
                      viewed={isPromptTabViewed(
                        downloadId,
                        overview.id,
                        tab,
                        runStatuses[overview.id]?.updatedAt,
                        viewedAt
                      )}
                    />
                  ) : null}
                  {otherPrompts.length > 0 ? <DropdownMenuSeparator /> : null}
                  {otherPrompts.map((prompt) => (
                    <PromptMenuItem
                      active={tab === prompt.id}
                      icon={<AiPromptIcon className="size-4 shrink-0" icon={prompt.icon} />}
                      key={prompt.id}
                      label={promptLabel(prompt, t)}
                      onSelect={() => selectTab(prompt.id)}
                      promptId={prompt.id}
                      status={runStatuses[prompt.id]?.status}
                      viewed={isPromptTabViewed(
                        downloadId,
                        prompt.id,
                        tab,
                        runStatuses[prompt.id]?.updatedAt,
                        viewedAt
                      )}
                    />
                  ))}
                  {chatThreads.length > 0 ? <DropdownMenuSeparator /> : null}
                  {chatThreads.map((thread) => (
                    <PromptMenuItem
                      active={threadId === thread.id}
                      icon={<MessageCircle aria-hidden className="size-4 shrink-0" />}
                      key={thread.id}
                      label={thread.title.trim() || t('transcript.promptHistoryChat')}
                      onSelect={() => selectConversation(AI_CHAT_PROMPT_ID, thread.id)}
                      promptId={thread.id}
                      status={thread.running ? 'running' : undefined}
                      viewed
                    />
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col" data-vt="transcript-tab">
        {activePrompt ? (
          <TranscriptPromptPane
            currentTimeMs={currentTimeMs}
            downloadId={downloadId}
            hasProvider={hasProvider}
            hasStoredTranscript={hasStoredTranscript}
            onSeek={onSeek}
            prompt={activePrompt}
            ready={canUsePrompts}
            settingsReady={settingsReady}
            sourceByline={sourceByline}
            sourceCover={sourceCover}
            sourceDurationMs={sourceDurationMs}
            sourceTitle={sourceTitle}
            sourceUrl={sourceUrl}
            threadId={threadId}
            transcriptLanguage={transcriptLanguage}
            transcriptOrigin={transcriptOrigin}
            transcriptRunning={running && !canUsePrompts}
            transcriptText={promptTranscriptText}
          />
        ) : (
          <TranscriptCaptionsPane
            collapsed={false}
            currentSegmentId={currentSegmentId}
            currentTimeMs={currentTimeMs}
            downloadId={downloadId}
            embedded
            error={error}
            failed={failed}
            noSpeech={noSpeech}
            noSpeechDetail={noSpeechDetail}
            onCancel={onCancel}
            onRetry={onRetry}
            onSeek={onSeek}
            onStart={onStart}
            ready={ready}
            resolveColorIndex={resolveColorIndex}
            resolveSpeaker={resolveSpeaker}
            running={running}
            runningLabel={runningLabel}
            segments={segments}
            sourceByline={sourceByline}
            sourceCover={sourceCover}
            sourceDurationMs={sourceDurationMs}
            sourceTitle={sourceTitle}
            speakers={speakers}
            stage={stage}
            stageHistory={stageHistory}
            streamLive={streamLive}
          />
        )}
        <TranscriptPromptHistory
          currentDownloadId={downloadId}
          currentPromptId={tab === 'transcript' ? null : tab}
          currentThreadId={threadId}
          onDeleted={onHistoryDeleted}
          onOpenChange={setHistoryOpen}
          onSelect={openHistoryItem}
          open={historyOpen}
          promptLabel={(promptId) => {
            if (promptId === AI_CHAT_PROMPT_ID) {
              return t('transcript.promptHistoryChat')
            }
            const prompt = allPrompts.find((entry) => entry.id === promptId)
            return prompt ? promptLabel(prompt, t) : promptId
          }}
        />
      </div>
    </div>
  )
}
