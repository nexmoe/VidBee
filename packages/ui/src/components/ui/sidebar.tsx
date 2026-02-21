import { CheckCircle2, Download, Info, Rss, Settings } from 'lucide-react'
import type * as React from 'react'
import { cn } from '../../lib/cn'
import { Button } from './button'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

type Page = 'home' | 'subscriptions' | 'settings' | 'about'
type NavigationTarget = Page | 'supported-sites'

interface SidebarIcon {
  active: React.ComponentType<{ className?: string }>
  inactive: React.ComponentType<{ className?: string }>
}

interface SidebarLabels {
  download: string
  subscriptions: string
  supportedSites: string
  settings: string
  about: string
}

interface SidebarIcons {
  home: SidebarIcon
  subscriptions: SidebarIcon
  supportedSites: SidebarIcon
  settings: SidebarIcon
  about: SidebarIcon
}

interface SidebarProps {
  currentPage: Page
  onPageChange: (page: Page) => void
  onOpenSupportedSites: () => void
  labels: SidebarLabels
  updateAvailable?: boolean
  logoSrc?: string
  logoAlt?: string
  appName?: string
  className?: string
  icons?: Partial<SidebarIcons>
}

interface NavigationItem {
  id: NavigationTarget
  icon: SidebarIcon
  label: string
  onClick?: () => void
}

interface PageNavigationItem {
  id: Page
  icon: SidebarIcon
  label: string
}

const defaultIcons: SidebarIcons = {
  home: {
    active: Download,
    inactive: Download
  },
  subscriptions: {
    active: Rss,
    inactive: Rss
  },
  supportedSites: {
    active: CheckCircle2,
    inactive: CheckCircle2
  },
  settings: {
    active: Settings,
    inactive: Settings
  },
  about: {
    active: Info,
    inactive: Info
  }
}

const getIcon = (icons: Partial<SidebarIcons> | undefined, key: keyof SidebarIcons): SidebarIcon => {
  return icons?.[key] ?? defaultIcons[key]
}

export function Sidebar({
  currentPage,
  onPageChange,
  onOpenSupportedSites,
  labels,
  updateAvailable = false,
  logoSrc = './app-icon.png',
  logoAlt = 'App icon',
  appName = 'App',
  className,
  icons
}: SidebarProps) {
  const navigationItems: NavigationItem[] = [
    {
      id: 'home',
      icon: getIcon(icons, 'home'),
      label: labels.download
    },
    {
      id: 'subscriptions',
      icon: getIcon(icons, 'subscriptions'),
      label: labels.subscriptions
    },
    {
      id: 'supported-sites',
      icon: getIcon(icons, 'supportedSites'),
      label: labels.supportedSites,
      onClick: onOpenSupportedSites
    }
  ]

  const bottomNavigationItems: PageNavigationItem[] = [
    {
      id: 'settings',
      icon: getIcon(icons, 'settings'),
      label: labels.settings
    },
    {
      id: 'about',
      icon: getIcon(icons, 'about'),
      label: labels.about
    }
  ]

  const renderNavigationItem = (item: NavigationItem, showLabel = true) => {
    const isActive = item.id !== 'supported-sites' && currentPage === item.id
    const IconComponent = isActive ? item.icon.active : item.icon.inactive
    const handleClick = item.onClick ?? (() => onPageChange(item.id as Page))

    return (
      <div className="flex flex-col items-center gap-1" key={item.id}>
        <Button
          className={cn('no-drag h-12 w-12 rounded-2xl', isActive && 'bg-primary/10')}
          onClick={handleClick}
          size="icon"
          variant="ghost"
        >
          <IconComponent className={cn('h-5! w-5!', isActive && 'text-primary')} />
        </Button>

        {showLabel ? (
          <span className="px-3 text-center text-muted-foreground text-xs leading-tight">{item.label}</span>
        ) : null}
      </div>
    )
  }

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
        <span className="text-center font-bold text-muted-foreground text-xs leading-tight">{appName}</span>
      </div>

      {navigationItems.map((item) => renderNavigationItem(item))}

      <div className="flex-1" />

      {bottomNavigationItems.map((item) => {
        const isActive = currentPage === item.id
        const IconComponent = isActive ? item.icon.active : item.icon.inactive
        const showUpdateDot = item.id === 'about' && updateAvailable

        return (
          <div className="flex flex-col items-center gap-1" key={item.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className={cn('no-drag relative h-12 w-12 rounded-2xl', isActive && 'bg-primary/10')}
                  onClick={() => onPageChange(item.id)}
                  size="icon"
                  variant="ghost"
                >
                  <IconComponent className={cn('h-5! w-5!', isActive && 'text-primary')} />
                  {showUpdateDot ? (
                    <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-red-500" />
                  ) : null}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>{item.label}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        )
      })}
    </aside>
  )
}

export type { Page as SidebarPage, SidebarIcon, SidebarIcons, SidebarLabels, SidebarProps }
