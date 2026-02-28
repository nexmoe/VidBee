import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Button } from './button'

export interface DownloadFilterItem<TFilter extends string> {
  key: TFilter
  label: string
  count: number
}

interface DownloadFilterBarProps<TFilter extends string> {
  filters: Array<DownloadFilterItem<TFilter>>
  activeFilter: TFilter
  onFilterChange: (filter: TFilter) => void
  actions?: ReactNode
}

export const DownloadFilterBar = <TFilter extends string>({
  filters,
  activeFilter,
  onFilterChange,
  actions
}: DownloadFilterBarProps<TFilter>) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((filter) => {
          const isActive = activeFilter === filter.key
          return (
            <Button
              className={
                isActive
                  ? 'h-8 rounded-full px-3 shadow-sm'
                  : 'h-8 rounded-full border border-border/60 px-3'
              }
              key={filter.key}
              onClick={() => onFilterChange(filter.key)}
              size="sm"
              variant={isActive ? 'secondary' : 'ghost'}
            >
              <span>{filter.label}</span>
              <span
                className={cn(
                  'ml-1 min-w-5 rounded-full px-1 font-medium text-neutral-900 text-xs',
                  isActive ? 'bg-neutral-100' : 'bg-neutral-200'
                )}
              >
                {filter.count}
              </span>
            </Button>
          )
        })}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}
