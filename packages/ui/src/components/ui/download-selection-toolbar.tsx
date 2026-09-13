'use client'

import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check, ListPlus, Minus, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Button } from './button'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

const ICON_CARD_CLASS =
  'h-8 w-8 shrink-0 rounded-full transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] [&_svg]:size-4'

interface DownloadSelectionToolbarProps {
  allSelected: boolean
  countLabel: string
  selectAllLabel: string
  clearLabel: string
  addToPlaylistLabel?: string
  deleteLabel: string
  onToggleSelectAll: () => void
  onAddToPlaylist?: () => void
  onDelete: () => void
  className?: string
}

interface SelectionIconCardProps {
  label: string
  onClick: () => void
  children: ReactNode
  className?: string
  testId: string
}

interface SelectionMasterCheckboxProps {
  allSelected: boolean
  selectAllLabel: string
  clearLabel: string
  onToggle: () => void
}

/**
 * Compact icon-only control used as an action card in the selection toolbar.
 */
function SelectionIconCard({
  label,
  onClick,
  children,
  className,
  testId
}: SelectionIconCardProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={cn(ICON_CARD_CLASS, className)}
          data-testid={testId}
          onClick={onClick}
          size="icon"
          type="button"
          variant="ghost"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Circular master checkbox: mixed shows minus and selects all, checked clears.
 */
function SelectionMasterCheckbox({
  allSelected,
  selectAllLabel,
  clearLabel,
  onToggle
}: SelectionMasterCheckboxProps) {
  const label = allSelected ? clearLabel : selectAllLabel
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <CheckboxPrimitive.Root
          aria-label={label}
          checked={allSelected ? true : 'indeterminate'}
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97] [&_svg]:size-3"
          data-testid="download-selection-master"
          onCheckedChange={() => onToggle()}
        >
          <CheckboxPrimitive.Indicator className="flex items-center justify-center">
            {allSelected ? <Check strokeWidth={3} /> : <Minus strokeWidth={3} />}
          </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Floating bulk-selection bar: master checkbox, count, and icon-card actions.
 */
export function DownloadSelectionToolbar({
  allSelected,
  countLabel,
  selectAllLabel,
  clearLabel,
  addToPlaylistLabel,
  deleteLabel,
  onToggleSelectAll,
  onAddToPlaylist,
  onDelete,
  className
}: DownloadSelectionToolbarProps) {
  return (
    <div
      aria-label={countLabel}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-border/50 bg-background/80 py-1 pr-1 pl-2.5 shadow-lg backdrop-blur',
        className
      )}
      data-testid="download-selection-toolbar"
      role="toolbar"
    >
      <SelectionMasterCheckbox
        allSelected={allSelected}
        clearLabel={clearLabel}
        onToggle={onToggleSelectAll}
        selectAllLabel={selectAllLabel}
      />
      <span className="whitespace-nowrap px-2 font-medium text-sm tabular-nums">{countLabel}</span>
      {addToPlaylistLabel && onAddToPlaylist ? (
        <SelectionIconCard
          label={addToPlaylistLabel}
          onClick={onAddToPlaylist}
          testId="download-selection-add-playlist"
        >
          <ListPlus />
        </SelectionIconCard>
      ) : null}
      <SelectionIconCard
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        label={deleteLabel}
        onClick={onDelete}
        testId="download-selection-delete"
      >
        <Trash2 />
      </SelectionIconCard>
    </div>
  )
}
