import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { XIcon } from 'lucide-react'
import { type ComponentProps, isValidElement, type ReactElement, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

type DialogProps = Omit<DialogPrimitive.Root.Props, 'onOpenChange'> & {
  onOpenChange?: (open: boolean) => void
}

interface CloseAutoFocusEvent {
  preventDefault: () => void
}

type DialogContentProps = ComponentProps<typeof DialogPrimitive.Popup> & {
  showCloseButton?: boolean
  position?: string
  size?: string
  container?: HTMLElement | null
  onCloseAutoFocus?: (event: CloseAutoFocusEvent) => void
  onPointerDownOutside?: (event: { preventDefault: () => void; target: EventTarget | null }) => void
  onInteractOutside?: (event: { preventDefault: () => void; target: EventTarget | null }) => void
  onFocusOutside?: (event: { preventDefault: () => void; target: EventTarget | null }) => void
  onEscapeKeyDown?: (event: { preventDefault: () => void }) => void
}

/**
 * Map Radix `asChild` onto Base UI `render`.
 *
 * @param asChild Whether the single child should replace the host element.
 * @param children Trigger or close contents.
 */
function asChildRender(
  asChild: boolean | undefined,
  children: ReactNode
): { render?: ReactElement; children?: ReactNode } {
  if (asChild && isValidElement(children)) {
    return { render: children }
  }
  return { children }
}

/**
 * Map Radix `onCloseAutoFocus` onto Base UI `finalFocus`.
 *
 * @param onCloseAutoFocus Legacy focus handler; `preventDefault` keeps focus where the caller put it.
 */
function toFinalFocus(
  onCloseAutoFocus?: (event: CloseAutoFocusEvent) => void
): DialogPrimitive.Popup.Props['finalFocus'] {
  if (!onCloseAutoFocus) {
    return undefined
  }
  return () => {
    let prevented = false
    onCloseAutoFocus({
      preventDefault: () => {
        prevented = true
      }
    })
    return !prevented
  }
}

/**
 * Dialog state container. Does not render a DOM node.
 */
function Dialog({ onOpenChange, ...props }: DialogProps) {
  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      onOpenChange={onOpenChange ? (open) => onOpenChange(open) : undefined}
      {...props}
    />
  )
}

/**
 * Button that opens the dialog.
 */
function DialogTrigger({
  asChild,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Trigger> & { asChild?: boolean }) {
  return (
    <DialogPrimitive.Trigger
      data-slot="dialog-trigger"
      {...props}
      {...asChildRender(asChild, children)}
    />
  )
}

/**
 * Portal that mounts the overlay and popup.
 */
function DialogPortal({ ...props }: ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

/**
 * Button that closes the dialog.
 */
function DialogClose({
  asChild,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Close> & { asChild?: boolean }) {
  return (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      {...props}
      {...asChildRender(asChild, children)}
    />
  )
}

/**
 * Dimmed layer behind the popup.
 */
function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Backdrop>) {
  return (
    <DialogPrimitive.Backdrop
      className={cn(
        'fixed inset-0 z-50 bg-black/50 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
        className
      )}
      data-slot="dialog-overlay"
      {...props}
    />
  )
}

/**
 * Centered dialog surface. Keep `container` / `showCloseButton` for existing callers.
 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  position: _position,
  size: _size,
  container,
  onCloseAutoFocus,
  onPointerDownOutside: _onPointerDownOutside,
  onInteractOutside: _onInteractOutside,
  onFocusOutside: _onFocusOutside,
  onEscapeKeyDown: _onEscapeKeyDown,
  ...props
}: DialogContentProps) {
  return (
    <DialogPortal container={container} data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Popup
        className={cn(
          'fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none transition-[opacity,transform] duration-200 sm:max-w-lg',
          'data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
          className
        )}
        data-slot="dialog-content"
        finalFocus={toFinalFocus(onCloseAutoFocus)}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0"
            data-slot="dialog-close"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

/**
 * Title + description stack.
 */
function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      data-slot="dialog-header"
      {...props}
    />
  )
}

/**
 * Action row under the dialog body.
 */
function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      data-slot="dialog-footer"
      {...props}
    />
  )
}

/**
 * Accessible dialog title.
 */
function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('font-semibold text-lg leading-none', className)}
      data-slot="dialog-title"
      {...props}
    />
  )
}

/**
 * Accessible dialog description.
 */
function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-muted-foreground text-sm', className)}
      data-slot="dialog-description"
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger
}
