import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import '../../assets/title-bar.css'
import { updateAvailableAtom } from '@renderer/store/update'
import MingcuteCheckCircleFill from '~icons/mingcute/check-circle-fill'
import MingcuteCheckCircleLine from '~icons/mingcute/check-circle-line'
import MingcuteDownload3Fill from '~icons/mingcute/download-3-fill'
import MingcuteDownload3Line from '~icons/mingcute/download-3-line'
import MingcuteInformationFill from '~icons/mingcute/information-fill'
import MingcuteInformationLine from '~icons/mingcute/information-line'
import MingcuteRssFill from '~icons/mingcute/rss-fill'
import MingcuteRssLine from '~icons/mingcute/rss-line'
import MingcuteSettingsFill from '~icons/mingcute/settings-3-fill'
import MingcuteSettingsLine from '~icons/mingcute/settings-3-line'

type Page = 'home' | 'subscriptions' | 'settings' | 'about'
type NavigationTarget = Page | 'supported-sites'

interface NavigationItem {
  id: NavigationTarget
  icon: {
    active: React.ComponentType<{ className?: string }>
    inactive: React.ComponentType<{ className?: string }>
  }
  label: string
  onClick?: () => void
}

interface PageNavigationItem {
  id: Page
  icon: {
    active: React.ComponentType<{ className?: string }>
    inactive: React.ComponentType<{ className?: string }>
  }
  label: string
}

interface SidebarProps {
  currentPage: Page
  onPageChange: (page: Page) => void
  onOpenSupportedSites: () => void
}

export function Sidebar({ currentPage, onPageChange, onOpenSupportedSites }: SidebarProps) {
  const { t } = useTranslation()
  const [updateAvailable] = useAtom(updateAvailableAtom)

  const navigationItems: NavigationItem[] = [
    {
      id: 'home',
      icon: {
        active: MingcuteDownload3Fill,
        inactive: MingcuteDownload3Line
      },
      label: t('menu.download')
    },
    {
      id: 'subscriptions',
      icon: {
        active: MingcuteRssFill,
        inactive: MingcuteRssLine
      },
      label: t('menu.rss')
    },
    {
      id: 'supported-sites',
      icon: {
        active: MingcuteCheckCircleFill,
        inactive: MingcuteCheckCircleLine
      },
      label: t('menu.supportedSites'),
      onClick: onOpenSupportedSites
    }
  ]

  const bottomNavigationItems: PageNavigationItem[] = [
    {
      id: 'settings',
      icon: {
        active: MingcuteSettingsFill,
        inactive: MingcuteSettingsLine
      },
      label: t('menu.preferences')
    },
    {
      id: 'about',
      icon: {
        active: MingcuteInformationFill,
        inactive: MingcuteInformationLine
      },
      label: t('menu.about')
    }
  ]

  const renderNavigationItem = (item: NavigationItem, showLabel = true) => {
    const isActive = item.id !== 'supported-sites' && currentPage === item.id
    const IconComponent = isActive ? item.icon.active : item.icon.inactive
    const handleClick = item.onClick ?? (() => onPageChange(item.id as Page))

    return (
      <div className="flex flex-col items-center gap-1" key={item.id}>
        <Button
          className={`no-drag h-12 w-12 rounded-2xl ${isActive ? 'bg-primary/10' : ''}`}
          onClick={handleClick}
          size="icon"
          variant="ghost"
        >
          <IconComponent className={`h-5! w-5! ${isActive ? 'text-primary' : ''}`} />
        </Button>

        {showLabel && (
          <span className="px-3 text-center text-muted-foreground text-xs leading-tight">
            {item.label}
          </span>
        )}
      </div>
    )
  }

  return (
    <aside className="drag-region flex w-20 min-w-20 max-w-20 flex-col items-center gap-2 border-border/60 border-r bg-background/77 py-4">
      {/* App Logo */}
      <div className="mt-4 flex flex-col items-center gap-1 py-3">
        <div className="flex h-12 w-12 items-center justify-center">
          <img alt="VidBee" className="h-10 w-10" src="./app-icon.png" />
        </div>
        <span className="text-center font-bold text-muted-foreground text-xs leading-tight">
          VidBee
        </span>
      </div>

      {/* Navigation Items */}
      {navigationItems.map((item) => renderNavigationItem(item))}

      <div className="flex-1" />

      {/* Bottom Navigation Items */}
      {bottomNavigationItems.map((item) => {
        const isActive = currentPage === item.id
        const IconComponent = isActive ? item.icon.active : item.icon.inactive
        const showUpdateDot = item.id === 'about' && updateAvailable.available

        return (
          <div className="flex flex-col items-center gap-1" key={item.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className={`no-drag relative h-12 w-12 rounded-2xl ${
                    isActive ? 'bg-primary/10' : ''
                  }`}
                  onClick={() => onPageChange(item.id)}
                  size="icon"
                  variant="ghost"
                >
                  <IconComponent className={`h-5! w-5! ${isActive ? 'text-primary' : ''}`} />
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
