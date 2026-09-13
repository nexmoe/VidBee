'use client'

import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area'
import {
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type Ref,
  createContext,
  forwardRef,
  useContext
} from 'react'
import { useTouchPrimary } from '../../hooks/use-touch-primary'
import { cn } from '../../lib/cn'
import { useShape } from '../../lib/shape-context'

const ScrollAreaContext = createContext(false)

type Orientation = 'vertical' | 'horizontal' | 'both'

interface ScrollAreaProps extends ComponentPropsWithoutRef<'div'> {
  viewportClassName?: string
  /** Ref for the scrolling viewport, used when callers need `scrollTop`. */
  viewportRef?: Ref<HTMLDivElement>
  /** Extra attributes for the scrolling viewport (events, aria, tabIndex). */
  viewportProps?: ComponentPropsWithoutRef<'div'>
  /** Which axes get scrollbars. Defaults to `"vertical"`. */
  orientation?: Orientation
}

/**
 * Scroll container with a shape-system overlay scrollbar.
 * Falls back to native overflow scrolling on touch-primary devices.
 */
const ScrollArea = forwardRef<ComponentRef<typeof ScrollAreaPrimitive.Root>, ScrollAreaProps>(
  ({ className, children, viewportClassName, viewportRef, viewportProps, orientation = 'vertical', ...props }, ref) => {
    const isTouch = useTouchPrimary()

    return (
      <ScrollAreaContext.Provider value={isTouch}>
        {isTouch ? (
          <div
            aria-roledescription="scroll area"
            className={cn('relative', className, 'overflow-hidden')}
            data-orientation={orientation}
            data-slot="scroll-area"
            ref={ref}
            role="group"
            {...props}
          >
            <div
              className={cn(
                'size-full rounded-[inherit]',
                orientation === 'vertical' && 'overflow-y-auto',
                orientation === 'horizontal' && 'overflow-x-auto',
                orientation === 'both' && 'overflow-auto',
                viewportClassName
              )}
              data-slot="scroll-area-viewport"
              ref={viewportRef}
              tabIndex={0}
              {...viewportProps}
            >
              {children}
            </div>
          </div>
        ) : (
          <ScrollAreaPrimitive.Root
            className={cn('relative', className, 'overflow-hidden')}
            data-orientation={orientation}
            data-slot="scroll-area"
            ref={ref}
            {...props}
          >
            <ScrollAreaPrimitive.Viewport
              className={cn('size-full rounded-[inherit]', viewportClassName)}
              data-slot="scroll-area-viewport"
              ref={viewportRef}
              {...viewportProps}
            >
              <ScrollAreaPrimitive.Content>{children}</ScrollAreaPrimitive.Content>
            </ScrollAreaPrimitive.Viewport>
            {orientation !== 'horizontal' && <ScrollBar orientation="vertical" />}
            {orientation !== 'vertical' && <ScrollBar orientation="horizontal" />}
            {orientation === 'both' && <ScrollAreaPrimitive.Corner />}
          </ScrollAreaPrimitive.Root>
        )}
      </ScrollAreaContext.Provider>
    )
  }
)

ScrollArea.displayName = 'ScrollArea'

/**
 * Overlay scrollbar thumb. No-ops on touch-primary devices where native overflow is used.
 */
const ScrollBar = forwardRef<
  ComponentRef<typeof ScrollAreaPrimitive.Scrollbar>,
  ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Scrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => {
  const isTouch = useContext(ScrollAreaContext)
  const shape = useShape()

  if (isTouch) {
    return null
  }

  return (
    <ScrollAreaPrimitive.Scrollbar
      className={cn(
        'group/scrollbar absolute z-20 flex touch-none select-none',
        'opacity-0 transition-opacity delay-[160ms] duration-[120ms] ease-out',
        'data-[hovering]:delay-0 data-[scrolling]:delay-0',
        'data-[hovering]:duration-[160ms] data-[scrolling]:duration-[160ms]',
        'data-[hovering]:opacity-100 data-[scrolling]:opacity-100',
        orientation === 'vertical' && 'top-0 right-0 h-full w-2.5',
        orientation === 'horizontal' && 'bottom-0 left-0 h-2.5 w-full flex-col',
        className
      )}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      ref={ref}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        className={cn(
          'relative bg-[rgb(var(--overlay)/0.08)] transition-[background-color,width,height] duration-[160ms] ease-in-out',
          'active:!bg-[rgb(var(--overlay)/0.16)] group-hover/scrollbar:bg-[rgb(var(--overlay)/0.12)]',
          shape.bg,
          orientation === 'vertical' &&
            'mx-auto my-1 h-[var(--scroll-area-thumb-height)] w-1 -translate-x-0.5 group-hover/scrollbar:w-1.5',
          orientation === 'horizontal' &&
            'mt-auto mb-0 mx-1 h-1 w-[var(--scroll-area-thumb-width)] group-hover/scrollbar:h-1.5'
        )}
        data-slot="scroll-area-thumb"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
})

ScrollBar.displayName = 'ScrollBar'

export type { ScrollAreaProps }
export { ScrollArea, ScrollBar }
