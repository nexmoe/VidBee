import type * as React from 'react'
import { cn } from '../../lib/cn'

/**
 * Vertical stack of related messages in one turn.
 */
function MessageGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-2', className)}
      data-slot="message-group"
      {...props}
    />
  )
}

/**
 * One conversational row. Use `align="end"` for the local user.
 */
function Message({
  className,
  align = 'start',
  ...props
}: React.ComponentProps<'div'> & { align?: 'start' | 'end' }) {
  return (
    <div
      className={cn(
        'group/message relative flex w-full min-w-0 gap-2 text-sm data-[align=end]:flex-row-reverse',
        className
      )}
      data-align={align}
      data-slot="message"
      {...props}
    />
  )
}

/**
 * Optional avatar slot aligned to the message bubble.
 */
function MessageAvatar({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex w-fit min-w-8 shrink-0 items-center justify-center self-end overflow-hidden rounded-full bg-muted',
        className
      )}
      data-slot="message-avatar"
      {...props}
    />
  )
}

/**
 * Column that holds the header, bubble, and footer.
 */
function MessageContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'wrap-break-word flex w-full min-w-0 flex-col gap-2.5 group-data-[align=end]/message:*:data-slot:self-end',
        className
      )}
      data-slot="message-content"
      {...props}
    />
  )
}

/**
 * Small label above the bubble, such as a speaker name.
 */
function MessageHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex min-w-0 max-w-full items-center px-3 font-medium text-muted-foreground text-xs group-has-data-[variant=ghost]/message:px-0',
        className
      )}
      data-slot="message-header"
      {...props}
    />
  )
}

/**
 * Actions or timestamps below the bubble.
 *
 * Flush with ThinkingSteps and ghost answers. A default bubble can opt back
 * into `px-3` at the call site if its content is padded.
 */
function MessageFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex min-w-0 max-w-full items-center font-medium text-muted-foreground text-xs group-data-[align=end]/message:justify-end',
        className
      )}
      data-slot="message-footer"
      {...props}
    />
  )
}

export { Message, MessageAvatar, MessageContent, MessageFooter, MessageGroup, MessageHeader }
