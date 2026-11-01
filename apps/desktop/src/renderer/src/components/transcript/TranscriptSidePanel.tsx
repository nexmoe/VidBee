import { TabUnderline } from '@renderer/components/transcript/TabUnderline'
import { TranscriptCaptionsPane } from '@renderer/components/transcript/TranscriptCaptionsPane'
import { TranscriptPromptHistory } from '@renderer/components/transcript/TranscriptPromptHistory'
import { TranscriptPromptPane } from '@renderer/components/transcript/TranscriptPromptPane'
import { usePromptRunStatuses } from '@renderer/hooks/use-prompt-run'
import { aiPromptLabel } from '@renderer/lib/ai-prompt-label'
import { ipcEvents, ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import { prefersReducedMotion } from '@renderer/lib/transcript-follow'
import { findTranscriptTab, scrollTranscriptTabIntoView } from '@renderer/lib/transcript-tab-scroll'
import {
  startTypedViewTransition,
  TRANSCRIPT_VT_TAB
} from '@renderer/lib/transcript-view-transition'
import { pendingPromptTabAtom } from '@renderer/store/transcript-prompt-tab'
import type {
  TranscriptSegmentView,
  TranscriptSnapshotView,
  TranscriptSpeakerView
} from '@renderer/store/transcripts'
import { AGENT_WORKSPACE_ID, type AgentRunEvent, type AgentThreadSummary } from '@shared/agent-chat'
import {
  type CatalogMemoryEntry,
  mergeCatalogList,
  rememberCatalog
} from '@shared/agent-thread-patch'
import { buildOverviewPromptTranscriptText } from '@shared/ai-prompt-text'
import {
  AI_CHAT_PROMPT_ID,
  AI_OVERVIEW_PROMPT_ID,
  agentChatPrompt,
  isTranscriptSkillVisible,
  partitionTranscriptPromptTabs
} from '@shared/ai-prompts'
import type { AiSettingsSnapshot } from '@shared/ai-types'
import { useNavigate } from '@tanstack/react-router'
import { AgentWorkspaceTabs } from '@vidbee/ui/components/agent-workspace'
import { useAtom } from 'jotai'
import { Captions } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  /** Available subtitle sources for bilingual reading. */
  sources?: TranscriptSnapshotView['sources']
  /** Whether these captions came from ASR / platform-auto or a human track. */
  transcriptOrigin?: 'ai' | 'human'
  /** Typewriter incoming ASR lines. Off when viewing a finished caption track. */
  streamLive?: boolean
  transcriptText: string
  /** True when Desktop already has a stored transcript record. */
  hasStoredTranscript?: boolean
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
  sources,
  transcriptOrigin,
  transcriptText,
  hasStoredTranscript = false
}: TranscriptSidePanelProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [pendingTab, setPendingTab] = useAtom(pendingPromptTabAtom)
  const tabsRef = useRef<HTMLDivElement>(null)
  const [snapshot, setSnapshot] = useState<AiSettingsSnapshot | null>(null)
  const [tab, setTab] = useState(routeTab ?? 'transcript')
  const [threadId, setThreadId] = useState<string | null>(routeThreadId ?? null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [videoThreads, setVideoThreads] = useState<AgentThreadSummary[]>([])
  const [chatLaunchDraft, setChatLaunchDraft] = useState<{
    threadId: string
    text: string
  } | null>(null)
  const [openChatIdsByVideo, setOpenChatIdsByVideo] = useState<Record<string, string[]>>(() =>
    routeTab === AI_CHAT_PROMPT_ID && routeThreadId ? { [downloadId]: [routeThreadId] } : {}
  )
  const [viewedAt, setViewedAt] = useState<Record<string, number>>({})
  const tabsViewportRef = useRef<HTMLDivElement>(null)
  const scrolledDownloadIdRef = useRef(downloadId)
  const scrolledTabIdRef = useRef<string | null>(null)
  const canUsePrompts = promptsReady ?? !running
  /**
   * Same wait control while the file is still downloading and after it finishes,
   * until a transcript exists. No-speech and failed runs keep the guidance.
   */
  const canWaitForTranscript = !(canUsePrompts || noSpeech || failed)

  /**
   * Load installed skills, sidebar preferences and the active provider.
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
    const listener = ipcEvents.on('ai:settings-changed', () => void refresh())
    return () => ipcEvents.removeListener('ai:settings-changed', listener)
  }, [refresh])

  /**
   * Close the overflow prompt menu.
   */
  const closeMenu = useCallback((): void => {
    setMenuOpen(false)
  }, [])

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
      if (item.downloadId === AGENT_WORKSPACE_ID) {
        void navigate({ to: '/chat', search: { thread: item.id } })
        return
      }
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
    [downloadId, navigate, onOpenDownload, openChatTab, selectConversation, setPendingTab]
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
  const catalogMemory = useRef(new Map<string, CatalogMemoryEntry>())
  const catalogClock = useRef(0)
  const refreshVideoThreads = useCallback(async (): Promise<void> => {
    const seen = catalogClock.current
    try {
      const rows = await ipcServices.ai.listAgentThreads({ downloadId })
      setVideoThreads(mergeCatalogList(rows, catalogMemory.current, seen, { downloadId }))
    } catch (error) {
      logger.error('Failed to load video conversations', error)
    }
  }, [downloadId])

  /**
   * Start a new Agent chat on this video, optionally seeding an unsent composer draft.
   */
  const startNewChat = useCallback(
    async (initialDraft = ''): Promise<void> => {
      try {
        const thread = await ipcServices.ai.createAgentThread({ downloadId })
        setChatLaunchDraft(initialDraft ? { threadId: thread.id, text: initialDraft } : null)
        await refreshVideoThreads()
        openChatTab(thread.id)
        selectConversation(AI_CHAT_PROMPT_ID, thread.id)
      } catch (error) {
        logger.error('Failed to start a new chat', error)
      }
    },
    [downloadId, openChatTab, refreshVideoThreads, selectConversation]
  )

  /** Consume the initial draft after the new chat has hydrated, so reopening it never refills it. */
  const consumeChatLaunchDraft = useCallback((id: string): void => {
    setChatLaunchDraft((current) => (current?.threadId === id ? null : current))
  }, [])

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
    catalogMemory.current = new Map()
    catalogClock.current = 0
    void refreshVideoThreads()
    const listener = ipcEvents.on('ai:agent-event', (...args: unknown[]) => {
      const event = args[0] as AgentRunEvent
      const notice = event?.catalog
      if (!notice) {
        return
      }
      const owner = notice.kind === 'remove' ? notice.downloadId : notice.summary.downloadId
      if (owner !== downloadId) {
        return
      }
      const next = rememberCatalog(catalogMemory.current, notice)
      if (!next.applied) {
        return
      }
      catalogMemory.current = next.memory
      catalogClock.current = Math.max(catalogClock.current, notice.revision)
      setVideoThreads((current) =>
        mergeCatalogList(current, catalogMemory.current, notice.revision - 1, { downloadId })
      )
    })
    const repair = (): void => {
      void refreshVideoThreads()
    }
    window.addEventListener('focus', repair)
    window.addEventListener('online', repair)
    return () => {
      ipcEvents.removeListener('ai:agent-event', listener)
      window.removeEventListener('focus', repair)
      window.removeEventListener('online', repair)
    }
  }, [downloadId, refreshVideoThreads])

  const openChatIds = openChatIdsByVideo[downloadId] ?? []
  const chatThreads = openChatIds
    .map((id) =>
      videoThreads.find((thread) => thread.id === id && thread.promptId === AI_CHAT_PROMPT_ID)
    )
    .filter((thread): thread is AgentThreadSummary => Boolean(thread))
  const activeTabId = tab === AI_CHAT_PROMPT_ID ? (threadId ?? tab) : tab
  const activeTabPresent =
    tab === AI_CHAT_PROMPT_ID
      ? chatThreads.some((thread) => thread.id === activeTabId)
      : tab === 'transcript' ||
        Boolean(
          snapshot?.prompts.some(
            (prompt) => prompt.name === tab && isTranscriptSkillVisible(prompt)
          )
        )

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
    const behavior =
      prefersReducedMotion() ||
      scrolledTabIdRef.current === null ||
      scrolledTabIdRef.current === activeTabId
        ? 'auto'
        : 'smooth'
    let frame = 0
    /** Reveal the selected chip after tab insertion and scroll-area layout have settled. */
    const revealActiveTab = (): void => {
      const activeTab = findTranscriptTab(list, activeTabId)
      if (!activeTab) {
        return
      }
      scrolledTabIdRef.current = activeTabId
      scrollTranscriptTabIntoView(viewport, activeTab, behavior)
    }
    /** Coalesce layout updates so new and resized tabs use their final bounds. */
    const scheduleReveal = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(revealActiveTab)
    }
    const observer = new ResizeObserver(scheduleReveal)
    observer.observe(list)
    observer.observe(viewport)
    scheduleReveal()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [activeTabId, activeTabPresent, collapsed, downloadId])

  const allPrompts = snapshot?.prompts ?? []
  const prompts = allPrompts.filter(isTranscriptSkillVisible)
  const { overview, rest: otherPrompts } = partitionTranscriptPromptTabs(prompts)
  const runStatuses = usePromptRunStatuses(
    downloadId,
    prompts.map((prompt) => prompt.name)
  )

  useEffect(() => {
    if (
      !threadId &&
      snapshot?.prompts.some((prompt) => prompt.name === tab && !isTranscriptSkillVisible(prompt))
    ) {
      selectTab('transcript')
    }
  }, [selectTab, snapshot, tab, threadId])

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

  const storedPrompt =
    allPrompts.find(
      (prompt) => prompt.name === tab && (threadId || isTranscriptSkillVisible(prompt))
    ) ?? null
  const activePrompt =
    tab === 'transcript'
      ? null
      : (storedPrompt ?? (tab === AI_CHAT_PROMPT_ID || threadId ? agentChatPrompt() : null))
  const settingsReady = snapshot !== null
  const hasProvider = Boolean(snapshot?.activeProviderId)
  const promptTranscriptText =
    activePrompt?.name === AI_OVERVIEW_PROMPT_ID
      ? buildOverviewPromptTranscriptText(segments, resolveSpeaker, {
          durationMs: sourceDurationMs,
          title: sourceTitle
        })
      : transcriptText
  return (
    <div className="relative flex h-full min-h-0 flex-col border-border/60 border-t bg-background lg:border-t-0 lg:border-l">
      <AgentWorkspaceTabs
        activeId={activeTabId}
        historyOpen={historyOpen}
        labels={{
          newChat: t('transcript.promptHistoryNew'),
          history: t('transcript.promptHistory'),
          closeHistory: t('transcript.promptHistoryClose'),
          menu: t('transcript.promptMenu'),
          closeTab: t('transcript.promptTabClose')
        }}
        menuOpen={menuOpen}
        onHistory={() => {
          closeMenu()
          setHistoryOpen((current) => !current)
        }}
        onMenuOpenChange={setMenuOpen}
        onNewChat={() => {
          closeMenu()
          void startNewChat()
        }}
        onSelect={(id) => {
          const chat = chatThreads.find((item) => item.id === id)
          if (chat) {
            selectConversation(AI_CHAT_PROMPT_ID, chat.id)
          } else {
            selectTab(id)
          }
        }}
        tabs={[
          {
            id: 'transcript',
            label: t('transcript.title'),
            icon: <Captions aria-hidden className="size-4" />
          },
          ...[...(overview ? [overview] : []), ...otherPrompts].map((prompt, index) => ({
            id: prompt.name,
            label: aiPromptLabel(prompt, t),
            separate: prompt.name !== AI_OVERVIEW_PROMPT_ID && index === (overview ? 1 : 0),
            status: runStatuses[prompt.name]?.status,
            statusLabel: t(
              runStatuses[prompt.name]?.status === 'running'
                ? 'transcript.promptRunning'
                : runStatuses[prompt.name]?.status === 'error'
                  ? 'transcript.promptTabError'
                  : 'transcript.promptTabCompleted'
            ),
            viewed: isPromptTabViewed(
              downloadId,
              prompt.name,
              tab,
              runStatuses[prompt.name]?.updatedAt,
              viewedAt
            )
          })),
          ...chatThreads.map((thread) => ({
            id: thread.id,
            label: thread.title.trim() || t('transcript.promptHistoryChat'),
            status: thread.running ? 'running' : undefined,
            viewed: true,
            onClose: () => closeChatTab(thread.id)
          }))
        ]}
        tabsRef={tabsRef}
        underline={<TabUnderline activeId={activeTabId} />}
        viewportRef={tabsViewportRef}
      />
      <div className="relative flex min-h-0 flex-1 flex-col" data-vt="transcript-tab">
        {activePrompt ? (
          <TranscriptPromptPane
            currentTimeMs={currentTimeMs}
            downloadId={downloadId}
            hasProvider={hasProvider}
            hasStoredTranscript={hasStoredTranscript}
            initialDraft={chatLaunchDraft?.threadId === threadId ? chatLaunchDraft.text : undefined}
            onSeek={onSeek}
            onThreadChange={consumeChatLaunchDraft}
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
            transcriptRunning={canWaitForTranscript}
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
            onTranslate={() =>
              void startNewChat(`$translate ${t('transcript.translateSubtitlesPrompt')}`)
            }
            ready={ready}
            resolveColorIndex={resolveColorIndex}
            resolveSpeaker={resolveSpeaker}
            running={running}
            runningLabel={runningLabel}
            segments={segments}
            sourceByline={sourceByline}
            sourceCover={sourceCover}
            sourceDurationMs={sourceDurationMs}
            sources={sources}
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
            const prompt = allPrompts.find((entry) => entry.name === promptId)
            return prompt ? aiPromptLabel(prompt, t) : promptId
          }}
        />
      </div>
    </div>
  )
}
