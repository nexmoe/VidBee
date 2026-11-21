import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility
} from '@shadcn/react/message-scroller'
import { ArrowDownIcon } from 'lucide-react'
import * as React from 'react'
import { cn } from '../../lib/cn'
import { Button } from './button'

const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '])

/**
 * Headless owner of transcript scroll state, auto-follow, and anchoring.
 */
function MessageScrollerProvider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>
) {
  return <MessageScrollerPrimitive.Provider {...props} />
}

/**
 * Styled frame that fills a height-constrained parent.
 */
function MessageScroller({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      className={cn(
        'group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden',
        className
      )}
      data-slot="message-scroller"
      {...props}
    />
  )
}

/**
 * Native scroll viewport for the transcript rows.
 * overflow-anchor is disabled so token/layout growth is not treated as a user scroll-up.
 */
function MessageScrollerViewport({
  className,
  onKeyDown,
  onTouchMove,
  onTouchStart,
  onWheel,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  const { scrollToEnd } = useMessageScroller()
  const touchY = React.useRef<number | null>(null)

  /** Keep following when downward input reaches an edge without producing a scroll event. */
  function resumeFollowing(event: React.SyntheticEvent<HTMLDivElement>): void {
    const element = event.currentTarget
    if (
      !event.defaultPrevented &&
      element.scrollHeight - element.scrollTop - element.clientHeight <= 1
    ) {
      scrollToEnd({ behavior: 'instant' })
    }
  }

  /** Wheel input belongs to this viewport, including when it is nested inside another scroller. */
  function handleWheel(event: React.WheelEvent<HTMLDivElement>): void {
    event.stopPropagation()
    onWheel?.(event)
    if (event.deltaY >= 0) {
      resumeFollowing(event)
    }
  }

  /** Keep navigation within nested viewports while allowing other keyboard shortcuts to bubble. */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (SCROLL_KEYS.has(event.key)) {
      event.stopPropagation()
    }
    onKeyDown?.(event)
    if (
      event.key === 'ArrowDown' ||
      event.key === 'End' ||
      event.key === 'PageDown' ||
      (event.key === ' ' && !event.shiftKey)
    ) {
      resumeFollowing(event)
    }
  }

  /** Remember the initial finger position before the primitive receives a scroll intent. */
  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>): void {
    touchY.current = event.touches[0]?.clientY ?? null
    onTouchStart?.(event)
  }

  /** Isolate nested touch scrolling and preserve following for gestures toward the live edge. */
  function handleTouchMove(event: React.TouchEvent<HTMLDivElement>): void {
    event.stopPropagation()
    const nextY = event.touches[0]?.clientY ?? null
    const towardEnd = nextY !== null && touchY.current !== null && nextY < touchY.current
    touchY.current = nextY
    onTouchMove?.(event)
    if (towardEnd) {
      resumeFollowing(event)
    }
  }

  return (
    <MessageScrollerPrimitive.Viewport
      className={cn(
        'size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain [overflow-anchor:none]',
        className
      )}
      data-slot="message-scroller-viewport"
      onKeyDown={handleKeyDown}
      onTouchMove={handleTouchMove}
      onTouchStart={handleTouchStart}
      onWheel={handleWheel}
      {...props}
    />
  )
}

/**
 * Live-region list that holds message rows.
 */
function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      className={cn('flex h-max min-h-full flex-col gap-6', className)}
      data-slot="message-scroller-content"
      {...props}
    />
  )
}

/**
 * One measured transcript row. Mark turn starts with `scrollAnchor`.
 */
function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      className={cn('min-w-0 shrink-0', className)}
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      {...props}
    />
  )
}

/**
 * Jump-to-edge control. Hidden while the viewport is already caught up.
 */
function MessageScrollerButton({
  direction = 'end',
  className,
  children,
  render,
  variant = 'secondary',
  size = 'icon',
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <MessageScrollerPrimitive.Button
      className={cn(
        'absolute left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-background text-foreground shadow-md transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:data-[active=false]:-translate-y-full data-[active=false]:pointer-events-none data-[direction=start]:top-4 data-[direction=end]:bottom-4 data-[active=true]:translate-y-0 data-[active=false]:scale-95 data-[active=true]:scale-100 data-[active=false]:opacity-0 data-[active=true]:opacity-100 data-[active=true]:active:scale-[0.97] data-[direction=start]:[&_svg]:rotate-180',
        className
      )}
      data-direction={direction}
      data-size={size}
      data-slot="message-scroller-button"
      data-variant={variant}
      direction={direction}
      render={render ?? <Button className="rounded-full shadow-md" size={size} variant={variant} />}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDownIcon />
          <span className="sr-only">
            {direction === 'end' ? 'Scroll to end' : 'Scroll to start'}
          </span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  )
}

export {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility
}
