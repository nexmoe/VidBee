import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { saveSettingAtom } from '@renderer/store/settings'
import { type LanguageCode, languageList, normalizeLanguageCode } from '@shared/languages'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import '../../assets/title-bar.css'
import MingcuteCheckCircleFill from '~icons/mingcute/check-circle-fill'
import MingcuteCheckCircleLine from '~icons/mingcute/check-circle-line'
import MingcuteDownload3Fill from '~icons/mingcute/download-3-fill'
import MingcuteDownload3Line from '~icons/mingcute/download-3-line'
import MingcuteGlobeLine from '~icons/mingcute/globe-2-line'
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
  const { t, i18n } = useTranslation()
  const saveSetting = useSetAtom(saveSettingAtom)

  const languageOptions = languageList

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

  const activeLanguageCode = normalizeLanguageCode(i18n.language)
  const currentLanguage =
    languageOptions.find((option) => option.value === activeLanguageCode) ?? languageOptions[0]

  const handleLanguageChange = async (value: LanguageCode) => {
    if (activeLanguageCode === value) {
      return
    }

    await saveSetting({ key: 'language', value })
    await i18n.changeLanguage(value)
    toast.success(t('notifications.settingsSaved'))
  }

  const renderNavigationItem = (item: NavigationItem, showLabel = true) => {
    const isActive = item.id !== 'supported-sites' && currentPage === item.id
    const IconComponent = isActive ? item.icon.active : item.icon.inactive
    const handleClick = item.onClick ?? (() => onPageChange(item.id as Page))

    return (
      <div key={item.id} className="flex flex-col items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClick}
          className={`no-drag rounded-2xl w-12 h-12 ${isActive ? 'bg-primary/10' : ''}`}
        >
          <IconComponent className={`h-5! w-5! ${isActive ? 'text-primary' : ''}`} />
        </Button>

        {showLabel && (
          <span className="text-xs text-muted-foreground text-center leading-tight px-3">
            {item.label}
          </span>
        )}
      </div>
    )
  }

  return (
    <aside className="drag-region w-20 max-w-20 min-w-20 border-r border-border/60 bg-background/77 flex flex-col items-center py-4 gap-2">
      {/* App Logo */}
      <div className="flex flex-col items-center gap-1 py-3 mt-4">
        <div className="w-12 h-12 flex items-center justify-center">
          <img src="./app-icon.png" alt="VidBee" className="w-10 h-10" />
        </div>
        <span className="text-xs text-muted-foreground font-bold text-center leading-tight">
          VidBee
        </span>
      </div>

      {/* Navigation Items */}
      {navigationItems.map((item) => renderNavigationItem(item))}

      <div className="flex-1" />

      {/* Language Selector */}
      <div className="flex flex-col items-center gap-1">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="no-drag rounded-2xl w-12 h-12">
                  <MingcuteGlobeLine className="h-5! w-5!" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{t('settings.language')}</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="right" align="end">
            {languageOptions.map((option) => {
              const isActive = option.value === currentLanguage.value

              return (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => void handleLanguageChange(option.value)}
                  className={isActive ? 'font-semibold bg-muted focus:bg-muted' : undefined}
                  aria-current={isActive}
                >
                  <div className="flex items-center gap-2">
                    <span className={`${option.flag} rounded-xs text-base`} aria-hidden="true" />
                    <span lang={option.hreflang}>{option.name}</span>
                  </div>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Bottom Navigation Items */}
      {bottomNavigationItems.map((item) => {
        const isActive = currentPage === item.id
        const IconComponent = isActive ? item.icon.active : item.icon.inactive

        return (
          <div key={item.id} className="flex flex-col items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onPageChange(item.id)}
                  className={`no-drag rounded-2xl w-12 h-12 ${isActive ? 'bg-primary/10' : ''}`}
                >
                  <IconComponent className={`h-5! w-5! ${isActive ? 'text-primary' : ''}`} />
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
