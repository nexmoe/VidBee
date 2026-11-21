import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowDown,
  Check,
  ChevronDown,
  History,
  MoreHorizontal,
  Plus,
  Sparkles,
  X
} from 'lucide-react'
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { cn } from '../lib/cn'
import { TabUnderline } from './agent-tab-underline'
import { Bubble, BubbleContent } from './ui/bubble'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Message, MessageContent, MessageFooter } from './ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport
} from './ui/message-scroller'
import { ScrollArea } from './ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

export interface AgentWorkspaceTab {
  id: string
  label: string
  icon?: ReactNode
  status?: string
  statusLabel?: string
  viewed?: boolean
  separate?: boolean
  disabled?: boolean
  onClose?: () => void
}

/** Preserve Overview's distinctive icon in both clients and the overflow menu. */
function TabIcon({ tab }: { tab: AgentWorkspaceTab }) {
  return tab.icon ?? (tab.id === 'overview' ? <Sparkles aria-hidden className="size-4" /> : null)
}

/** Keep the running/unread indicator identical in tabs and the overflow menu. */
function TabStatus({ tab, menu = false }: { tab: AgentWorkspaceTab; menu?: boolean }) {
  const status =
    tab.status === 'running'
      ? 'running'
      : tab.viewed
        ? null
        : tab.status === 'completed'
          ? 'completed'
          : tab.status === 'error'
            ? 'error'
            : null
  if (!status) {
    return null
  }
  return (
    <span
      aria-hidden
      className="relative inline-flex size-1.5 shrink-0"
      data-status={status}
      data-testid={`prompt-tab-status-${menu ? 'menu-' : ''}${tab.id}`}
      title={tab.statusLabel}
    >
      {status === 'running' ? (
        <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-60 motion-reduce:hidden" />
      ) : null}
      <span
        className={cn(
          'relative block size-1.5 rounded-full',
          status === 'running'
            ? 'bg-primary'
            : status === 'completed'
              ? 'bg-emerald-500'
              : 'bg-red-500'
        )}
      />
    </span>
  )
}

/** Shared skill/chat navigation, including overflow, independent chats, and history. */
export function AgentWorkspaceTabs({
  tabs,
  activeId,
  onSelect,
  onNewChat,
  onHistory,
  historyOpen,
  labels,
  disabled,
  underline,
  tabsRef,
  viewportRef,
  menuOpen,
  onMenuOpenChange
}: {
  tabs: AgentWorkspaceTab[]
  activeId: string
  onSelect: (id: string) => void
  onNewChat: () => void
  onHistory: () => void
  historyOpen: boolean
  labels: { newChat: string; history: string; closeHistory: string; menu: string; closeTab: string }
  disabled?: boolean
  underline?: ReactNode
  tabsRef?: RefObject<HTMLDivElement | null>
  viewportRef?: RefObject<HTMLDivElement | null>
  menuOpen?: boolean
  onMenuOpenChange?: (open: boolean) => void
}) {
  const localTabs = useRef<HTMLDivElement>(null)
  const localViewport = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [localMenuOpen, setLocalMenuOpen] = useState(false)
  const effectiveTabsRef = tabsRef ?? localTabs
  const effectiveViewportRef = viewportRef ?? localViewport
  /** Cancel hover dismissal without reopening a menu that is already closing. */
  function cancelMenuClose(): void {
    clearTimeout(timer.current)
    timer.current = undefined
  }
  /** Keep controlled and local menu state in sync through one hover timer. */
  function setMenu(open: boolean): void {
    cancelMenuClose()
    setLocalMenuOpen(open)
    onMenuOpenChange?.(open)
  }
  /** Allow the pointer to cross the gap before dismissing the overflow menu. */
  function leaveMenu(): void {
    cancelMenuClose()
    timer.current = setTimeout(() => setMenu(false), 160)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  useLayoutEffect(() => {
    if (tabsRef || !tabs.some((tab) => tab.id === activeId)) {
      return
    }
    const list = effectiveTabsRef.current
    const viewport = effectiveViewportRef.current
    const tab = list
      ? [...list.querySelectorAll<HTMLElement>('[data-tab-id]')].find(
          (item) => item.dataset.tabId === activeId
        )
      : undefined
    if (!(tab && viewport)) {
      return
    }
    const rect = tab.getBoundingClientRect()
    const view = viewport.getBoundingClientRect()
    if (rect.left < view.left || rect.right > view.right) {
      viewport.scrollBy?.({
        left: rect.left < view.left ? rect.left - view.left : rect.right - view.right,
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth'
      })
    }
  }, [activeId, tabs, tabsRef, effectiveTabsRef, effectiveViewportRef])
  const indicator = underline ?? <TabUnderline activeId={activeId} />
  return (
    <div className="relative z-20 shrink-0 border-border/60 border-b">
      <ScrollArea
        className="w-full px-4 pr-28"
        orientation="horizontal"
        viewportClassName="h-auto overflow-y-hidden"
        viewportRef={effectiveViewportRef}
      >
        <div
          className="relative flex min-w-max items-end"
          data-testid="transcript-prompt-tabs"
          ref={effectiveTabsRef}
        >
          {indicator}
          {tabs.map((tab) => (
            <div className="contents" key={tab.id}>
              {tab.separate ? (
                <span aria-hidden className="mx-1.5 mb-3 h-3.5 w-px shrink-0 bg-border" />
              ) : null}
              <div className="relative inline-flex items-end" data-tab-id={tab.id}>
                <button
                  className={cn(
                    'inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap border-transparent border-b-2 px-2 py-2.5 font-medium text-sm transition-colors duration-200 disabled:cursor-default disabled:opacity-50',
                    tab.onClose && 'pr-6',
                    activeId === tab.id
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                    !indicator && activeId === tab.id && 'border-primary'
                  )}
                  disabled={tab.disabled}
                  onClick={() => {
                    setMenu(false)
                    onSelect(tab.id)
                  }}
                  type="button"
                >
                  <TabIcon tab={tab} />
                  <span className="max-w-40 truncate" title={tab.label}>
                    {tab.label}
                  </span>
                  <TabStatus tab={tab} />
                </button>
                {tab.onClose ? (
                  <button
                    aria-label={labels.closeTab}
                    className="absolute top-1/2 right-0.5 inline-flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    data-testid={`transcript-prompt-tab-close-${tab.id}`}
                    onClick={tab.onClose}
                    type="button"
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-stretch bg-gradient-to-l from-40% from-background to-transparent pl-6">
        <button
          aria-label={labels.newChat}
          className="pointer-events-auto inline-flex h-full w-9 cursor-pointer items-center justify-center text-muted-foreground hover:bg-muted/70 hover:text-foreground disabled:opacity-50"
          data-testid="transcript-prompt-new-chat"
          disabled={disabled}
          onClick={onNewChat}
          type="button"
        >
          <Plus className="size-4" />
        </button>
        <button
          aria-expanded={historyOpen}
          aria-label={historyOpen ? labels.closeHistory : labels.history}
          className={cn(
            'pointer-events-auto inline-flex h-full w-9 cursor-pointer items-center justify-center hover:bg-muted/70 hover:text-foreground',
            historyOpen ? 'bg-muted/70 text-foreground' : 'text-muted-foreground'
          )}
          data-testid="transcript-prompt-history"
          onClick={onHistory}
          type="button"
        >
          <History className="size-4" />
        </button>
        <div className="pointer-events-auto flex h-full items-stretch">
          <DropdownMenu modal={false} onOpenChange={setMenu} open={menuOpen ?? localMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={labels.menu}
                className="inline-flex h-full w-9 cursor-pointer items-center justify-center text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                data-testid="transcript-prompt-menu"
                onMouseEnter={() => {
                  setMenu(true)
                }}
                onMouseLeave={leaveMenu}
                type="button"
              >
                <ChevronDown className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="z-[80] max-h-72 w-64 min-w-0 max-w-[calc(100vw-1rem)]"
              collisionPadding={8}
              data-testid="transcript-prompt-menu-list"
              onMouseEnter={cancelMenuClose}
              onMouseLeave={leaveMenu}
              sideOffset={4}
            >
              {tabs.map((tab) => (
                <div className="contents" key={tab.id}>
                  {tab.separate ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem
                    className="flex items-center gap-2"
                    disabled={tab.disabled}
                    onSelect={() => {
                      setMenu(false)
                      onSelect(tab.id)
                    }}
                  >
                    <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
                      <TabIcon tab={tab} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left" title={tab.label}>
                      {tab.label}
                    </span>
                    <TabStatus menu tab={tab} />
                    {activeId === tab.id ? <Check className="size-3.5 shrink-0" /> : null}
                  </DropdownMenuItem>
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}

/** Message chrome shared by Desktop and browser clients, with platform actions supplied as slots. */
export function AgentMessageLayout({
  id,
  user,
  media,
  thinking,
  children,
  feedback,
  actions
}: {
  id: string
  user: boolean
  /** Unpadded attachments grouped above their text bubble. */
  media?: ReactNode
  thinking?: ReactNode
  children?: ReactNode
  feedback?: ReactNode
  actions?: ReactNode
}) {
  const bubble = children ? (
    <Bubble
      className={user ? 'max-w-full' : 'w-full max-w-full'}
      variant={user ? 'default' : 'ghost'}
    >
      <BubbleContent
        className={user ? 'w-full max-w-none' : 'w-full max-w-none overflow-visible p-0'}
      >
        {children}
      </BubbleContent>
    </Bubble>
  ) : null
  return (
    <Message align={user ? 'end' : 'start'} data-message-id={id}>
      <MessageContent className="gap-2">
        {thinking}
        {media ? (
          <div
            className={cn(
              'flex min-w-0 flex-col gap-1.5',
              user ? 'max-w-[85%] items-end self-end' : 'w-full'
            )}
            data-slot="message-media-group"
          >
            {media}
            {bubble}
          </div>
        ) : (
          bubble
        )}
        {feedback}
        {actions ? <MessageFooter className="gap-0 px-0">{actions}</MessageFooter> : null}
      </MessageContent>
    </Message>
  )
}

/** Consistent compact reply action with an accessible label and tooltip. */
export function AgentMessageAction({
  label,
  disabled,
  onClick,
  children,
  testId
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
  testId?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className="h-6 w-6 justify-center rounded-md p-0 text-muted-foreground [&_svg]:size-3.5"
          data-testid={testId}
          disabled={disabled}
          onClick={onClick}
          size="icon"
          type="button"
          variant="ghost"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const AGENT_COMPOSER_CLEARANCE =
  'var(--agent-composer-clearance, calc(44px + var(--agent-composer-bottom, var(--agent-composer-inset, 0.75rem))))'

/** Shared scroll and floating-composer geometry; runtimes provide messages and composer controls. */
export function AgentConversationLayout({
  identity,
  children,
  composer,
  notice,
  outputLabel,
  scrollLabel,
  autoScroll = true,
  viewportRef,
  scrollState
}: {
  identity: string
  children: ReactNode
  composer: ReactNode
  notice?: ReactNode
  outputLabel: string
  scrollLabel: string
  autoScroll?: boolean
  viewportRef?: RefObject<HTMLDivElement | null>
  scrollState?: ReactNode
}) {
  const pane = useRef<HTMLDivElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = pane.current
    const control = dock.current
    if (!(element && control)) {
      return
    }
    /** Reserve the complete floating dock, its notices and its distance from the pane's bottom. */
    const sync = (): void => {
      const bottom = Number.parseFloat(getComputedStyle(control).bottom) || 0
      element.style.setProperty(
        '--agent-composer-clearance',
        `${Math.ceil(control.offsetHeight + bottom)}px`
      )
    }
    sync()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(sync)
    observer.observe(control)
    observer.observe(element)
    return () => {
      observer.disconnect()
      element.style.removeProperty('--agent-composer-clearance')
    }
  }, [])
  return (
    <div
      className="relative flex h-full min-h-0 flex-col [--agent-composer-inset:0.75rem]"
      data-slot="agent-conversation"
      ref={pane}
    >
      <MessageScrollerProvider
        autoScroll={autoScroll}
        defaultScrollPosition="end"
        key={identity}
        scrollEdgeThreshold={32}
      >
        <MessageScroller className="min-h-0 flex-1" data-testid="transcript-prompt-output">
          <MessageScrollerViewport aria-label={outputLabel} ref={viewportRef}>
            <MessageScrollerContent
              className="mx-auto w-full max-w-[var(--agent-content-max-width,none)] gap-6 px-[22px] pt-[var(--agent-content-top-padding,1.25rem)] text-sm leading-relaxed"
              style={{ paddingBottom: `calc(${AGENT_COMPOSER_CLEARANCE} + 1rem)` }}
            >
              {children}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton style={{ bottom: `calc(${AGENT_COMPOSER_CLEARANCE} + 0.25rem)` }}>
            <ArrowDown />
            <span className="sr-only">{scrollLabel}</span>
          </MessageScrollerButton>
        </MessageScroller>
        {scrollState}
      </MessageScrollerProvider>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
        data-slot="message-send-layer"
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-[var(--agent-composer-bottom,var(--agent-composer-inset))] z-20 mx-auto w-full max-w-[var(--agent-content-max-width,none)] px-[var(--agent-composer-inset)]"
        data-testid="agent-chat-composer-dock"
        ref={dock}
      >
        {notice ? <div className="pointer-events-auto pb-2">{notice}</div> : null}
        <div className="pointer-events-auto">{composer}</div>
      </div>
    </div>
  )
}

type AgentHistoryRow<T> =
  | { kind: 'heading'; key: string; label: string; first: boolean }
  | { kind: 'item'; key: string; item: T }

/** Virtualize measured, date-grouped history rows shared by both clients. */
export function AgentHistoryList<T extends { id: string; running: boolean }>({
  groups,
  currentId,
  loaded,
  emptyLabel,
  title,
  onSelect,
  onRename,
  canRename,
  onDelete,
  labels
}: {
  groups: { key: string; label: string; items: T[] }[]
  currentId?: string | null
  loaded: boolean
  emptyLabel: string
  title: (item: T) => string
  onSelect: (item: T) => void
  canRename?: (item: T) => boolean
  onRename?: (item: T) => void
  onDelete: (item: T) => void
  labels: { running: string; more: string; rename: string; delete: string }
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => {
    const result: AgentHistoryRow<T>[] = []
    for (const [index, group] of groups.entries()) {
      result.push({
        kind: 'heading',
        key: `heading:${group.key}`,
        label: group.label,
        first: index === 0
      })
      for (const item of group.items) {
        result.push({ kind: 'item', key: `item:${item.id}`, item })
      }
    }
    return result
  }, [groups])
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    getItemKey: (index) => rows[index]?.key ?? index,
    estimateSize: (index) => {
      const row = rows[index]
      return row?.kind === 'heading' ? (row.first ? 40 : 52) : 66
    },
    overscan: 8,
    useFlushSync: false
  })

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" ref={viewportRef}>
      {loaded && !groups.length ? (
        <p className="px-3 py-8 text-center text-muted-foreground text-sm">{emptyLabel}</p>
      ) : (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]
            if (!row) {
              return null
            }
            const item = row.kind === 'item' ? row.item : null
            return (
              <div
                className="absolute top-0 left-0 w-full"
                data-index={virtualRow.index}
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {row.kind === 'heading' ? (
                  <h3
                    className={cn(
                      'px-3 pb-2 font-semibold text-muted-foreground text-sm',
                      row.first ? 'pt-3' : 'pt-6'
                    )}
                  >
                    {row.label}
                  </h3>
                ) : item ? (
                  <div
                    className={cn(
                      'flex items-center gap-1 rounded-2xl px-3 py-3',
                      item.id === currentId ? 'bg-muted' : 'hover:bg-muted/50'
                    )}
                    data-testid={`transcript-prompt-history-item-${item.id}`}
                  >
                    <button
                      className="min-w-0 flex-1 cursor-pointer text-left font-normal text-[15px] text-foreground leading-snug [overflow-wrap:anywhere]"
                      onClick={() => onSelect(item)}
                      type="button"
                    >
                      <span className="line-clamp-2">{title(item)}</span>
                    </button>
                    {item.running ? (
                      <span
                        aria-hidden
                        className="relative inline-flex size-2 shrink-0"
                        data-status="running"
                        data-testid={`transcript-prompt-history-running-${item.id}`}
                        title={labels.running}
                      >
                        <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-60 motion-reduce:hidden" />
                        <span className="relative block size-2 rounded-full bg-primary" />
                      </span>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          aria-label={labels.more}
                          className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-background/80 hover:text-foreground"
                          type="button"
                        >
                          <MoreHorizontal className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {onRename && (!canRename || canRename(item)) ? (
                          <DropdownMenuItem onSelect={() => onRename(item)}>
                            {labels.rename}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem onSelect={() => onDelete(item)} variant="destructive">
                          {labels.delete}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
