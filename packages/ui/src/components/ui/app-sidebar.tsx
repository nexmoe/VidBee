import type * as React from 'react'
import { cn } from '../../lib/cn'
import { Button } from './button'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

interface AppSidebarIcon {
  active: React.ComponentType<{ className?: string }>
  inactive: React.ComponentType<{ className?: string }>
}

interface AppSidebarItem {
  id: string
  label: string
  icon: AppSidebarIcon
  active?: boolean
  disabled?: boolean
  indicator?: boolean
  showLabel?: boolean
  showTooltip?: boolean
  onClick?: () => void
}

interface AppSidebarProps {
  appName?: string
  logoSrc?: string
  logoAlt?: string
  className?: string
  items: AppSidebarItem[]
  bottomItems?: AppSidebarItem[]
}

const renderSidebarItem = (item: AppSidebarItem) => {
  const IconComponent = item.active ? item.icon.active : item.icon.inactive
  const showLabel = item.showLabel ?? true

  const button = (
    <Button
      className={cn('no-drag relative h-12 w-12 rounded-2xl', item.active && 'bg-primary/10')}
      disabled={item.disabled}
      onClick={item.onClick}
      size="icon"
      variant="ghost"
    >
      <IconComponent className={cn('h-5! w-5!', item.active && 'text-primary')} />
      {item.indicator ? (
        <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-red-500" />
      ) : null}
    </Button>
  )

  return (
    <div className="flex flex-col items-center gap-1" key={item.id}>
      {item.showTooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right">
            <p>{item.label}</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}

      {showLabel ? (
        <span className="px-3 text-center text-muted-foreground text-xs leading-tight">
          {item.label}
        </span>
      ) : null}
    </div>
  )
}

export function AppSidebar({
  appName = 'App',
  logoSrc = './app-icon.png',
  logoAlt = 'App icon',
  className,
  items,
  bottomItems = []
}: AppSidebarProps) {
  return (
    <aside
      className={cn(
        'drag-region flex w-20 min-w-20 max-w-20 flex-col items-center gap-2 border-border/60 border-r bg-background/77 py-4',
        className
      )}
    >
      <div className="mt-4 flex flex-col items-center gap-1 py-3">
        <div className="flex h-12 w-12 items-center justify-center">
          <img alt={logoAlt} className="h-10 w-10" src={logoSrc} />
        </div>
        <span className="text-center font-bold text-muted-foreground text-xs leading-tight">
          {appName}
        </span>
      </div>

      {items.map((item) => renderSidebarItem(item))}

      <div className="flex-1" />

      {bottomItems.map((item) => renderSidebarItem(item))}
    </aside>
  )
}

export type { AppSidebarIcon, AppSidebarItem, AppSidebarProps }
