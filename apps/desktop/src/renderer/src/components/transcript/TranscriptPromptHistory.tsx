import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
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
import { transcriptMapAtom } from '@renderer/store/transcripts'
import type { AgentRunEvent, AgentThreadSummary } from '@shared/agent-chat'
import {
  type AgentHistoryGroup,
  agentHistoryDisplayTitle,
  groupAgentHistory
} from '@shared/agent-history'
import {
  type CatalogMemoryEntry,
  mergeCatalogList,
  rememberCatalog
} from '@shared/agent-thread-patch'
import { AgentHistoryList } from '@vidbee/ui/components/agent-workspace'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const catalogMemory = useRef(new Map<string, CatalogMemoryEntry>())
  const catalogClock = useRef(0)

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
  const accept = useCallback((next: AgentThreadSummary[], seen = catalogClock.current): void => {
    setItems(mergeCatalogList(next, catalogMemory.current, seen, { historyOnly: true }))
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
      const seen = catalogClock.current
      void ipcServices.ai
        .listAgentHistory()
        .then((next) => {
          if (!cancelled) {
            accept(next, seen)
          }
        })
        .catch((error) => {
          logger.error('Failed to load conversation history', error)
          if (!cancelled) {
            setLoaded(true)
          }
        })
    }
    const onEvent = (...args: unknown[]): void => {
      const notice = (args[0] as AgentRunEvent | undefined)?.catalog
      if (cancelled || !notice) {
        return
      }
      const next = rememberCatalog(catalogMemory.current, notice)
      if (!next.applied) {
        return
      }
      catalogMemory.current = next.memory
      catalogClock.current = Math.max(catalogClock.current, notice.revision)
      setItems((current) =>
        mergeCatalogList(current, catalogMemory.current, notice.revision - 1, {
          historyOnly: true
        })
      )
    }
    refresh()
    const off = ipcEvents.on('ai:agent-event', onEvent)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => {
      cancelled = true
      ipcEvents.removeListener('ai:agent-event', off)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [accept, open])

  /**
   * Save the title chosen in the rename dialog.
   */
  const confirmRename = async (): Promise<void> => {
    if (!pendingRename) {
      return
    }
    const seen = catalogClock.current
    try {
      accept(
        await ipcServices.ai.renameAgentThread({
          threadId: pendingRename.id,
          title: renameDraft
        }),
        seen
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
    const seen = catalogClock.current
    try {
      accept(await ipcServices.ai.deleteAgentThread(item.id), seen)
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
          <AgentHistoryList
            canRename={(item) => item.promptId === 'chat'}
            currentId={
              currentThreadId ??
              titledItems.find(
                (item) => item.downloadId === currentDownloadId && item.promptId === currentPromptId
              )?.id
            }
            emptyLabel={t('transcript.promptHistoryEmpty')}
            groups={groups.map((group) => ({ ...group, label: historyGroupLabel(group, t) }))}
            labels={{
              running: t('transcript.promptRunning'),
              more: t('transcript.promptHistoryMore'),
              rename: t('transcript.promptHistoryRename'),
              delete: t('transcript.promptHistoryDelete')
            }}
            loaded={loaded}
            onDelete={setPendingDelete}
            onRename={(row) => {
              setPendingRename(row)
              setRenameDraft(row.title.trim())
            }}
            onSelect={onSelect}
            title={(item) =>
              agentHistoryDisplayTitle(
                item,
                t('transcript.promptHistoryUntitled'),
                promptLabel(item.promptId)
              )
            }
          />
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
