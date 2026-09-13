import { ChevronDown, FileAudio, Plus } from 'lucide-react'
import { useId } from 'react'
import { cn } from '../../lib/cn'
import { Button } from './button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './dropdown-menu'
import { Label } from './label'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Switch } from './switch'
import { Textarea } from './textarea'

interface AddUrlPopoverProps {
  open: boolean
  value: string
  triggerLabel: string
  title: string
  description?: string
  placeholder: string
  cancelLabel: string
  confirmLabel: string
  confirmDisabled?: boolean
  invalidMessage?: string
  supportedSitesLabel?: string
  onOpenSupportedSites?: () => void
  onOpenChange: (open: boolean) => void
  onTriggerClick: () => void
  onValueChange: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
  onAddLocalMedia?: () => void
  addLocalMediaLabel?: string
  moreActionsLabel?: string
  oneClickDownloadEnabled?: boolean
  oneClickDownloadLabel?: string
  oneClickDownloadDescription?: string
  onToggleOneClickDownload?: () => void
}

/**
 * Popover for pasting a video URL, toggling one-click download, and opening supported sites.
 */
export const AddUrlPopover = ({
  open,
  value,
  triggerLabel,
  title,
  description,
  placeholder,
  cancelLabel,
  confirmLabel,
  confirmDisabled = false,
  invalidMessage,
  supportedSitesLabel,
  onOpenSupportedSites,
  onOpenChange,
  onTriggerClick,
  onValueChange,
  onCancel,
  onConfirm,
  onAddLocalMedia,
  addLocalMediaLabel,
  moreActionsLabel,
  oneClickDownloadEnabled = false,
  oneClickDownloadLabel,
  oneClickDownloadDescription,
  onToggleOneClickDownload
}: AddUrlPopoverProps) => {
  const textareaId = useId()
  const descriptionId = useId()
  const showLocalMenu = Boolean(onAddLocalMedia && addLocalMediaLabel && moreActionsLabel)

  return (
    <div className={showLocalMenu ? 'inline-flex overflow-hidden rounded-full' : 'contents'}>
      <Popover onOpenChange={onOpenChange} open={open}>
        <PopoverTrigger asChild>
          <Button
            className={cn(
              'h-[34px] px-3.5',
              showLocalMenu ? 'rounded-none rounded-l-full' : 'rounded-full'
            )}
            onClick={onTriggerClick}
          >
            <Plus className="h-4 w-4" />
            {triggerLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 p-5">
          <div className="flex flex-col">
            <div>
              <Label className="font-semibold text-sm leading-snug" htmlFor={textareaId}>
                {title}
              </Label>
              {description ? (
                <p
                  className="mt-1 text-muted-foreground text-xs leading-relaxed"
                  id={descriptionId}
                >
                  {description}
                </p>
              ) : null}
              <Textarea
                aria-describedby={description ? descriptionId : undefined}
                aria-invalid={Boolean(invalidMessage)}
                autoFocus
                className="-mx-[3px] mt-3 min-h-24 w-[calc(100%+6px)] resize-none rounded-lg border-transparent bg-muted/70 px-3.5 py-3 text-sm shadow-none focus-visible:border-ring focus-visible:bg-background dark:bg-muted/50"
                id={textareaId}
                onChange={(event) => {
                  onValueChange(event.target.value)
                }}
                placeholder={placeholder}
                rows={4}
                value={value}
              />
              {invalidMessage ? (
                <p className="mt-2 text-destructive text-xs">{invalidMessage}</p>
              ) : null}
            </div>
            {onToggleOneClickDownload && oneClickDownloadLabel ? (
              <div className="mt-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm leading-snug">{oneClickDownloadLabel}</p>
                  {oneClickDownloadDescription ? (
                    <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
                      {oneClickDownloadDescription}
                    </p>
                  ) : null}
                </div>
                <Switch
                  aria-label={oneClickDownloadLabel}
                  checked={oneClickDownloadEnabled}
                  className="shrink-0"
                  data-testid="add-url-one-click"
                  label=""
                  onToggle={onToggleOneClickDownload}
                  size="compact"
                />
              </div>
            ) : null}
            <div className="mt-4 flex items-center justify-end gap-2 border-border/60 border-t pt-3">
              {onOpenSupportedSites && supportedSitesLabel ? (
                <Button
                  className="mr-auto h-auto px-0 font-normal text-muted-foreground text-xs hover:bg-transparent hover:text-foreground"
                  onClick={onOpenSupportedSites}
                  type="button"
                  variant="ghost"
                >
                  {supportedSitesLabel}
                </Button>
              ) : null}
              <Button onClick={onCancel} variant="outline">
                {cancelLabel}
              </Button>
              <Button disabled={confirmDisabled} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {showLocalMenu ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={moreActionsLabel}
              className="h-[34px] rounded-none border-primary-foreground/25 border-l px-2"
              data-testid="add-url-more"
              type="button"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              data-testid="add-local-media"
              onSelect={() => {
                onAddLocalMedia?.()
              }}
            >
              <FileAudio className="h-4 w-4" />
              {addLocalMediaLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}
