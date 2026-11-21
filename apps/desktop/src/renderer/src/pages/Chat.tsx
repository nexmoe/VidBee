import { AgentChat } from '@renderer/components/agent/AgentChat'
import { TranscriptPromptHistory } from '@renderer/components/transcript/TranscriptPromptHistory'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { aiPromptLabel } from '@renderer/lib/ai-prompt-label'
import { agentChatLaunchDraftAtom } from '@renderer/store/agent-chat-launch'
import { agentTaskAiSnapshotAtom } from '@renderer/store/agent-tasks'
import { AGENT_WORKSPACE_ID, type AgentThreadSummary } from '@shared/agent-chat'
import { AI_CHAT_PROMPT_ID } from '@shared/ai-prompts'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { atom, useAtom, useAtomValue } from 'jotai'
import { History, Plus, Puzzle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const CHAT_TOOLBAR_BUTTON_CLASS =
  'no-drag pointer-events-auto size-8 rounded-xl bg-transparent p-0 text-muted-foreground shadow-none hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground [&_svg]:size-4'

/** Keep the last opened conversation across page navigation in this application session. */
const lastChatThreadIdAtom = atom<string | null>(null)

/** Restore the last Agent chat or a conversation selected from history. */
export function Chat() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { thread } = useSearch({ from: '/chat' })
  const snapshot = useAtomValue(agentTaskAiSnapshotAtom)
  const [lastThreadId, setLastThreadId] = useAtom(lastChatThreadIdAtom)
  const [launchDraft, setLaunchDraft] = useAtom(agentChatLaunchDraftAtom)
  const [initialDraft, setInitialDraft] = useState(launchDraft ?? '')
  // Capture the navigation fallback once so hydration does not remount or reset the composer.
  const [resumeThreadId, setResumeThreadId] = useState(initialDraft ? null : lastThreadId)
  const [revision, setRevision] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null)

  useEffect(() => {
    if (launchDraft) {
      setLaunchDraft(null)
    }
  }, [launchDraft, setLaunchDraft])

  /** Remember hydrated conversations without changing the mounted chat's identity. */
  const rememberThread = useCallback(
    (id: string): void => {
      setCurrentThreadId(id)
      setLastThreadId(id)
    },
    [setLastThreadId]
  )

  /** Reset the conversation without interrupting replies running in other chats. */
  function newChat(): void {
    setInitialDraft('')
    setCurrentThreadId(null)
    setLastThreadId(null)
    setResumeThreadId(null)
    setRevision((current) => current + 1)
    void navigate({ to: '/chat', search: {} })
  }

  /** Open standalone chats here and video conversations in their transcript page. */
  function openConversation(item: AgentThreadSummary): void {
    setInitialDraft('')
    setHistoryOpen(false)
    if (item.downloadId === AGENT_WORKSPACE_ID) {
      void navigate({ to: '/chat', search: { thread: item.id } })
      return
    }
    void navigate({
      to: '/downloads/$downloadId/transcript',
      params: { downloadId: item.downloadId },
      search: { tab: item.promptId, thread: item.id }
    })
  }

  return (
    <section className="relative flex h-full min-h-0 flex-col" data-testid="agent-chat-page">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[calc(var(--agent-toolbar-top,1rem)+3rem)] bg-linear-to-b from-background/85 via-background/40 to-transparent"
      />
      <header className="pointer-events-none absolute inset-x-4 top-[var(--agent-toolbar-top,1rem)] z-50 flex h-8 items-center justify-end gap-2">
        <h1 className="sr-only">{t('transcript.promptHistoryChat')}</h1>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('settings.promptsTab')}
              className={CHAT_TOOLBAR_BUTTON_CLASS}
              onClick={() => void navigate({ to: '/settings', search: { tab: 'prompts' } })}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Puzzle aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            {t('settings.promptsTab')}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('transcript.promptHistoryNew')}
              className={CHAT_TOOLBAR_BUTTON_CLASS}
              onClick={newChat}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Plus aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            {t('transcript.promptHistoryNew')}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-expanded={historyOpen}
              aria-haspopup="dialog"
              aria-label={t('transcript.promptHistory')}
              className={CHAT_TOOLBAR_BUTTON_CLASS}
              onClick={() => setHistoryOpen(true)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <History aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent align="end" side="bottom" sideOffset={8}>
            {t('transcript.promptHistory')}
          </TooltipContent>
        </Tooltip>
      </header>
      <div className="flex min-h-0 w-full flex-1 flex-col [--agent-composer-bottom:1rem] [--agent-content-max-width:48rem] [--agent-content-top-padding:calc(var(--agent-toolbar-top,1rem)+3.75rem)] [&_[data-slot=message-scroller-viewport]]:[mask-image:linear-gradient(to_bottom,rgba(0,0,0,0.5),black_calc(var(--agent-toolbar-top,1rem)+2rem))]">
        <AgentChat
          hasProvider={Boolean(snapshot?.activeProviderId)}
          initialDraft={thread ? undefined : initialDraft}
          key={`${thread ?? 'new'}:${revision}`}
          onThreadChange={rememberThread}
          settingsReady={snapshot !== null}
          threadId={thread ?? resumeThreadId}
        />
      </div>
      <TranscriptPromptHistory
        currentDownloadId={AGENT_WORKSPACE_ID}
        currentPromptId={null}
        currentThreadId={currentThreadId ?? thread}
        onDeleted={(item) => {
          if (item.id === (currentThreadId ?? thread)) {
            newChat()
          }
        }}
        onOpenChange={setHistoryOpen}
        onSelect={openConversation}
        open={historyOpen}
        promptLabel={(id) => {
          if (id === AI_CHAT_PROMPT_ID) {
            return t('transcript.promptHistoryChat')
          }
          const prompt = snapshot?.prompts.find((item) => item.name === id)
          return prompt ? aiPromptLabel(prompt, t) : id
        }}
      />
    </section>
  )
}
