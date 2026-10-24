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
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  onMenuOpenChange,
  onMenuEnter,
  onMenuLeave
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
  onMenuEnter?: () => void
  onMenuLeave?: () => void
}) {
  const localTabs = useRef<HTMLDivElement>(null)
  const localViewport = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [localMenuOpen, setLocalMenuOpen] = useState(false)
  const effectiveTabsRef = tabsRef ?? localTabs
  const effectiveViewportRef = viewportRef ?? localViewport
  /** Keep the same hover handoff between the trigger and portalled overflow menu. */
  function setMenu(open: boolean): void {
    clearTimeout(timer.current)
    setLocalMenuOpen(open)
    onMenuOpenChange?.(open)
  }
  /** Allow the pointer to cross the gap before dismissing the overflow menu. */
  function leaveMenu(): void {
    timer.current = setTimeout(() => setMenu(false), 160)
    onMenuLeave?.()
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
                  <span className="max-w-40 truncate">{tab.label}</span>
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
                onFocus={() => {
                  setMenu(true)
                  onMenuEnter?.()
                }}
                onMouseEnter={() => {
                  setMenu(true)
                  onMenuEnter?.()
                }}
                onMouseLeave={leaveMenu}
                type="button"
              >
                <ChevronDown className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="z-[80] max-h-72 min-w-52"
              data-testid="transcript-prompt-menu-list"
              onMouseEnter={() => {
                setMenu(true)
                onMenuEnter?.()
              }}
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
                    <TabIcon tab={tab} />
                    <span className="min-w-0 flex-1 truncate">{tab.label}</span>
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
  thinking,
  children,
  feedback,
  actions
}: {
  id: string
  user: boolean
  thinking?: ReactNode
  children?: ReactNode
  feedback?: ReactNode
  actions?: ReactNode
}) {
  return (
    <Message align={user ? 'end' : 'start'} data-message-id={id}>
      <MessageContent className="gap-2">
        {thinking}
        {children ? (
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
        ) : null}
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
    /** Reserve exactly the visible composer's height so the final reply stays readable. */
    function sync(): void {
      element?.style.setProperty(
        '--agent-composer-height',
        `${control?.getBoundingClientRect().height ?? 0}px`
      )
    }
    sync()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(sync)
    observer.observe(control)
    return () => {
      observer.disconnect()
      element.style.removeProperty('--agent-composer-height')
    }
  }, [])
  return (
    <div
      className="relative flex h-full min-h-0 flex-col [--agent-composer-inset:0.75rem]"
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
            <MessageScrollerContent className="gap-6 px-5 pt-5 pb-[calc(var(--agent-composer-height,44px)+var(--agent-composer-inset)+1rem)] text-sm leading-relaxed">
              {children}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton className="data-[direction=end]:bottom-[calc(var(--agent-composer-height,44px)+var(--agent-composer-inset)+0.25rem)]">
            <ArrowDown />
            <span className="sr-only">{scrollLabel}</span>
          </MessageScrollerButton>
        </MessageScroller>
        {scrollState}
      </MessageScrollerProvider>
      <div
        className="pointer-events-none absolute inset-x-[var(--agent-composer-inset)] bottom-[var(--agent-composer-inset)] z-20"
        data-testid="agent-chat-composer-dock"
      >
        {notice ? <div className="pointer-events-auto pb-2">{notice}</div> : null}
        <div className="pointer-events-auto" ref={dock}>
          {composer}
        </div>
      </div>
    </div>
  )
}

/** Date-grouped history rows. Data loading and mutations remain in the transport adapters. */
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
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {loaded && !groups.length ? (
        <p className="px-3 py-8 text-center text-muted-foreground text-sm">{emptyLabel}</p>
      ) : (
        groups.map((group, index) => (
          <section key={group.key}>
            <h3
              className={cn(
                'px-3 pb-2 font-semibold text-muted-foreground text-sm',
                index === 0 ? 'pt-3' : 'pt-6'
              )}
            >
              {group.label}
            </h3>
            {group.items.map((item) => (
              <div
                className={cn(
                  'flex items-center gap-1 rounded-2xl px-3 py-3',
                  item.id === currentId ? 'bg-muted' : 'hover:bg-muted/50'
                )}
                data-testid={`transcript-prompt-history-item-${item.id}`}
                key={item.id}
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
            ))}
          </section>
        ))
      )}
    </div>
  )
}
