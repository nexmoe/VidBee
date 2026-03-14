import { Plus } from 'lucide-react'
import { useId } from 'react'
import { Button } from './button'
import { Label } from './label'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Textarea } from './textarea'

interface AddUrlPopoverProps {
  open: boolean
  value: string
  triggerLabel: string
  title: string
  placeholder: string
  cancelLabel: string
  confirmLabel: string
  confirmDisabled?: boolean
  invalidMessage?: string
  onOpenChange: (open: boolean) => void
  onTriggerClick: () => void
  onValueChange: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}

export const AddUrlPopover = ({
  open,
  value,
  triggerLabel,
  title,
  placeholder,
  cancelLabel,
  confirmLabel,
  confirmDisabled = false,
  invalidMessage,
  onOpenChange,
  onTriggerClick,
  onValueChange,
  onCancel,
  onConfirm
}: AddUrlPopoverProps) => {
  const textareaId = useId()

  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger asChild>
        <Button className="rounded-full" onClick={onTriggerClick}>
          <Plus className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] space-y-3">
        <div className="space-y-2">
          <Label htmlFor={textareaId}>{title}</Label>
          <Textarea
            autoFocus
            id={textareaId}
            onChange={(event) => {
              onValueChange(event.target.value.replace(/\r?\n/g, ''))
            }}
            placeholder={placeholder}
            rows={4}
            value={value}
          />
        </div>
        {invalidMessage ? <p className="text-destructive text-xs">{invalidMessage}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} variant="outline">
            {cancelLabel}
          </Button>
          <Button disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
