import { cn } from '@renderer/lib/utils'
import { commandMotionStyle } from '@vidbee/ui/components/ui/command-motion'
import { Command as CommandPrimitive } from 'cmdk'
import { Search } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog'
import './command.css'

/** Render the shadcn command root with the desktop theme. */
function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn(
        'flex min-h-0 w-full flex-col overflow-hidden bg-background text-foreground',
        className
      )}
      data-slot="command"
      {...props}
    />
  )
}

/** Host a command palette in the shared Base UI dialog. */
function CommandDialog({
  title,
  description,
  children,
  ...props
}: Omit<ComponentProps<typeof Dialog>, 'children'> & {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        className="command-dialog flex max-h-[76dvh] flex-col gap-0 overflow-hidden p-0 transition-none data-[ending-style]:scale-100 data-[starting-style]:scale-100 sm:max-w-xl"
        data-command-dialog=""
        showCloseButton={false}
        style={commandMotionStyle}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  )
}

/** Keep keyboard focus in the command search input. */
function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      className="flex shrink-0 items-center gap-3 border-b px-4"
      data-slot="command-input-wrapper"
    >
      <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <CommandPrimitive.Input
        className={cn(
          'h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50',
          className
        )}
        data-slot="command-input"
        {...props}
      />
    </div>
  )
}

/** Bound and scroll the command results independently of the page. */
function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn(
        'command-list min-h-0 scroll-py-2 overflow-y-auto overflow-x-hidden overscroll-contain p-2',
        className
      )}
      data-slot="command-list"
      {...props}
    />
  )
}

/** Announce an empty result set. */
function CommandEmpty(props: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className="py-10 text-center text-muted-foreground text-sm"
      data-slot="command-empty"
      {...props}
    />
  )
}

/** Label a section of command results. */
function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:text-xs',
        className
      )}
      data-slot="command-group"
      {...props}
    />
  )
}

/** Share pointer and keyboard selection for a command result. */
function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-3 rounded-lg px-2 py-2.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-active data-[selected=true]:text-foreground data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        className
      )}
      data-slot="command-item"
      {...props}
    />
  )
}

/** Display a keyboard hint without making it focusable. */
function CommandShortcut({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn('rounded border px-1 font-mono text-[10px] text-muted-foreground', className)}
      data-slot="command-shortcut"
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut
}
