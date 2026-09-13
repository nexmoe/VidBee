import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '../../lib/cn'

/**
 * Stack of bubbles inside one message.
 */
function BubbleGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-2', className)}
      data-slot="bubble-group"
      {...props}
    />
  )
}

const bubbleVariants = cva(
  'group/bubble relative flex w-fit min-w-0 max-w-[80%] flex-col gap-1 data-[variant=ghost]:max-w-full data-[align=end]:self-end group-data-[align=end]/message:self-end',
  {
    variants: {
      variant: {
        default:
          // 24px stays pill-like on one line (~42px tall) without stadium-clipping wrapped text.
          '*:data-[slot=bubble-content]:rounded-3xl *:data-[slot=bubble-content]:bg-[oklch(0.97_0.038_95)] *:data-[slot=bubble-content]:px-4 *:data-[slot=bubble-content]:py-2.5 *:data-[slot=bubble-content]:text-foreground dark:*:data-[slot=bubble-content]:bg-[oklch(0.32_0.04_95)]',
        secondary:
          '*:data-[slot=bubble-content]:bg-secondary *:data-[slot=bubble-content]:text-secondary-foreground',
        muted: '*:data-[slot=bubble-content]:bg-muted',
        outline:
          '*:data-[slot=bubble-content]:border-border *:data-[slot=bubble-content]:bg-background',
        ghost:
          'border-none *:data-[slot=bubble-content]:rounded-none *:data-[slot=bubble-content]:bg-transparent *:data-[slot=bubble-content]:p-0'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

/**
 * Chat bubble frame. Pair with `BubbleContent` for the painted surface.
 */
function Bubble({
  variant = 'default',
  align = 'start',
  className,
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof bubbleVariants> & {
    align?: 'start' | 'end'
  }) {
  return (
    <div
      className={cn(bubbleVariants({ variant }), className)}
      data-align={align}
      data-slot="bubble"
      data-variant={variant}
      {...props}
    />
  )
}

/**
 * Painted body of a bubble. Host markdown or short text here.
 */
function BubbleContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'wrap-break-word w-fit min-w-0 max-w-full overflow-hidden rounded-xl border border-transparent px-3 py-2 text-sm leading-relaxed',
        className
      )}
      data-slot="bubble-content"
      {...props}
    />
  )
}

export { Bubble, BubbleContent, BubbleGroup, bubbleVariants }
