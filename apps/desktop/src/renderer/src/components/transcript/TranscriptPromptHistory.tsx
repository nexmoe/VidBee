import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Input } from '@renderer/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@renderer/components/ui/sheet'
import { ipcEvents, ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import { cn } from '@renderer/lib/utils'
import { transcriptMapAtom } from '@renderer/store/transcripts'
import type { AgentThreadSummary } from '@shared/agent-chat'
import {
  type AgentHistoryGroup,
  agentHistoryDisplayTitle,
  groupAgentHistory
} from '@shared/agent-history'
import { AI_CHAT_PROMPT_ID } from '@shared/ai-prompts'
import { useAtomValue } from 'jotai'
import { MoreHorizontal } from 'lucide-react'
import { type MouseEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface TranscriptPromptHistoryProps {
  currentDownloadId: string
  currentPromptId: string | null
  currentThreadId?: string | null
  open: boolean
  promptLabel: (promptId: string) => string
  onDeleted: (item: AgentThreadSummary) => void
  onOpenChange: (open: boolean) => void
  onSelect: (item: AgentThreadSummary) => void
}

/**
 * Date-group heading for the conversation history drawer.
 *
 * @param group Group produced by `groupAgentHistory`.
 * @param t i18n function.
 */
function historyGroupLabel(
  group: AgentHistoryGroup<AgentThreadSummary>,
  t: (key: string) => string
): string {
  if (group.kind === 'today') {
    return t('transcript.promptHistoryToday')
  }
  if (group.kind === 'yesterday') {
    return t('transcript.promptHistoryYesterday')
  }
  return group.label ?? ''
}

interface HistoryRowProps {
  current: boolean
  item: AgentThreadSummary
  promptLabel: string
  onDelete: (item: AgentThreadSummary) => void
  onRename: (item: AgentThreadSummary) => void
  onSelect: (item: AgentThreadSummary) => void
}

/**
 * One conversation row: title and a more menu.
 */
function HistoryRow({ current, item, promptLabel, onDelete, onRename, onSelect }: HistoryRowProps) {
  const { t } = useTranslation()
  const title = agentHistoryDisplayTitle(item, t('transcript.promptHistoryUntitled'), promptLabel)

  /**
   * Keep row actions from also selecting the conversation.
   *
   * @param event Mouse event from a nested control.
   */
  const stopRow = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-2xl px-3 py-3',
        current ? 'bg-muted' : 'hover:bg-muted/50'
      )}
      data-testid={`transcript-prompt-history-item-${item.id}`}
    >
      <button
        className="min-w-0 flex-1 cursor-pointer text-left font-normal text-[15px] text-foreground leading-snug [overflow-wrap:anywhere]"
        onClick={() => onSelect(item)}
        type="button"
      >
        <span className="line-clamp-2">{title}</span>
      </button>
      {item.running ? (
        <span
          aria-hidden
          className="relative inline-flex size-2 shrink-0"
          data-status="running"
          data-testid={`transcript-prompt-history-running-${item.id}`}
          title={t('transcript.promptRunning')}
        >
          <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-60 motion-reduce:hidden" />
          <span className="relative block size-2 rounded-full bg-primary" />
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={t('transcript.promptHistoryMore')}
            className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
            onClick={stopRow}
            type="button"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={stopRow}>
          {item.promptId === AI_CHAT_PROMPT_ID ? (
            <DropdownMenuItem onSelect={() => onRename(item)}>
              {t('transcript.promptHistoryRename')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => onDelete(item)} variant="destructive">
            {t('transcript.promptHistoryDelete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * Conversation history drawer for transcript prompt tabs.
 */
export function TranscriptPromptHistory({
  currentDownloadId,
  currentPromptId,
  currentThreadId = null,
  open,
  promptLabel,
  onDeleted,
  onOpenChange,
  onSelect
}: TranscriptPromptHistoryProps) {
  const { t, i18n } = useTranslation()
  const transcripts = useAtomValue(transcriptMapAtom)
  const [items, setItems] = useState<AgentThreadSummary[]>([])
  const [loaded, setLoaded] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<AgentThreadSummary | null>(null)
  const [pendingRename, setPendingRename] = useState<AgentThreadSummary | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const titledItems = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        title: item.title.trim() || transcripts[item.downloadId]?.title?.trim() || ''
      })),
    [items, transcripts]
  )
  const groups = useMemo(
    () => groupAgentHistory(titledItems, Date.now(), i18n.language),
    [i18n.language, titledItems]
  )

  /**
   * Replace the drawer list after a successful history IPC call.
   *
   * @param next Rows returned by main.
   */
  const accept = useCallback((next: AgentThreadSummary[]): void => {
    setItems(next)
    setLoaded(true)
  }, [])

  /**
   * Load conversations when the drawer opens and keep them current while it stays open.
   */
  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    const refresh = (): void => {
      void ipcServices.ai
        .listAgentHistory()
        .then((next) => {
          if (!cancelled) {
            accept(next)
          }
        })
        .catch((error) => {
          logger.error('Failed to load conversation history', error)
          if (!cancelled) {
            setLoaded(true)
          }
        })
    }
    refresh()
    const off = ipcEvents.on('ai:agent-event', refresh)
    return () => {
      cancelled = true
      ipcEvents.removeListener('ai:agent-event', off as (...args: unknown[]) => void)
    }
  }, [accept, open])

  /**
   * Save the title chosen in the rename dialog.
   */
  const confirmRename = async (): Promise<void> => {
    if (!pendingRename) {
      return
    }
    try {
      accept(
        await ipcServices.ai.renameAgentThread({
          threadId: pendingRename.id,
          title: renameDraft
        })
      )
      setPendingRename(null)
    } catch (error) {
      logger.error('Failed to rename conversation', error)
    }
  }

  /**
   * Delete the conversation chosen in the confirm dialog.
   */
  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) {
      return
    }
    const item = pendingDelete
    try {
      accept(await ipcServices.ai.deleteAgentThread(item.id))
      setPendingDelete(null)
      onDeleted(item)
    } catch (error) {
      logger.error('Failed to delete conversation', error)
    }
  }

  return (
    <>
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetContent
          className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-sm"
          data-testid="transcript-prompt-history-drawer"
          side="right"
        >
          <SheetHeader className="shrink-0 space-y-1 border-border/60 border-b px-4 py-3 pr-12 text-left">
            <SheetTitle>{t('transcript.promptHistory')}</SheetTitle>
            <SheetDescription className="sr-only">
              {t('transcript.promptHistoryDescription')}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {loaded && titledItems.length === 0 ? (
              <p className="px-3 py-8 text-center text-muted-foreground text-sm">
                {t('transcript.promptHistoryEmpty')}
              </p>
            ) : (
              groups.map((group, index) => (
                <section key={group.key}>
                  <h3
                    className={cn(
                      'px-3 pb-2 font-semibold text-muted-foreground text-sm',
                      index === 0 ? 'pt-3' : 'pt-6'
                    )}
                  >
                    {historyGroupLabel(group, t)}
                  </h3>
                  {group.items.map((item) => (
                    <HistoryRow
                      current={
                        currentThreadId
                          ? item.id === currentThreadId
                          : item.downloadId === currentDownloadId &&
                            item.promptId === currentPromptId
                      }
                      item={item}
                      key={item.id}
                      onDelete={setPendingDelete}
                      onRename={(row) => {
                        setPendingRename(row)
                        setRenameDraft(row.title.trim())
                      }}
                      onSelect={onSelect}
                      promptLabel={promptLabel(item.promptId)}
                    />
                  ))}
                </section>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
      <Dialog
        onOpenChange={(next) => {
          if (!next) {
            setPendingDelete(null)
          }
        }}
        open={Boolean(pendingDelete)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('transcript.promptHistoryDeleteTitle')}</DialogTitle>
            <DialogDescription>{t('transcript.promptHistoryDeleteDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setPendingDelete(null)} type="button" variant="outline">
              {t('transcript.promptHistoryDeleteCancel')}
            </Button>
            <Button onClick={() => void confirmDelete()} type="button" variant="destructive">
              {t('transcript.promptHistoryDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={(next) => {
          if (!next) {
            setPendingRename(null)
          }
        }}
        open={Boolean(pendingRename)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('transcript.promptHistoryRenameTitle')}</DialogTitle>
            <DialogDescription>{t('transcript.promptHistoryRenameDescription')}</DialogDescription>
          </DialogHeader>
          <Input
            maxLength={80}
            onChange={(event) => setRenameDraft(event.target.value)}
            placeholder={t('transcript.promptHistoryRenamePlaceholder')}
            value={renameDraft}
          />
          <DialogFooter>
            <Button onClick={() => setPendingRename(null)} type="button" variant="outline">
              {t('transcript.promptHistoryDeleteCancel')}
            </Button>
            <Button
              disabled={!renameDraft.trim()}
              onClick={() => void confirmRename()}
              type="button"
            >
              {t('transcript.promptHistoryRenameSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
