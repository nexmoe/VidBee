import { AppSidebar, type AppSidebarItem } from '@vidbee/ui/components/ui/app-sidebar'
import { appSidebarIcons } from '@vidbee/ui/components/ui/app-sidebar-icons'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import '../../assets/title-bar.css'
import { updateAvailableAtom } from '@renderer/store/update'

type Page = 'home' | 'subscriptions' | 'settings' | 'about'

interface SidebarProps {
  currentPage: Page
  onPageChange: (page: Page) => void
  onOpenSupportedSites: () => void
}

export function Sidebar({ currentPage, onPageChange, onOpenSupportedSites }: SidebarProps) {
  const { t } = useTranslation()
  const updateAvailable = useAtomValue(updateAvailableAtom)

  const items: AppSidebarItem[] = [
    {
      id: 'home',
      active: currentPage === 'home',
      icon: appSidebarIcons.home,
      label: t('menu.download'),
      onClick: () => onPageChange('home')
    },
    {
      id: 'subscriptions',
      active: currentPage === 'subscriptions',
      icon: appSidebarIcons.subscriptions,
      label: t('menu.rss'),
      onClick: () => onPageChange('subscriptions')
    },
    {
      id: 'supported-sites',
      icon: appSidebarIcons.supportedSites,
      label: t('menu.supportedSites'),
      onClick: onOpenSupportedSites
    }
  ]

  const bottomItems: AppSidebarItem[] = [
    {
      id: 'settings',
      active: currentPage === 'settings',
      icon: appSidebarIcons.settings,
      label: t('menu.preferences'),
      onClick: () => onPageChange('settings'),
      showLabel: false,
      showTooltip: true
    },
    {
      id: 'about',
      active: currentPage === 'about',
      icon: appSidebarIcons.about,
      indicator: updateAvailable.available,
      label: t('menu.about'),
      onClick: () => onPageChange('about'),
      showLabel: false,
      showTooltip: true
    }
  ]

  return <AppSidebar appName="VidBee" bottomItems={bottomItems} items={items} logoAlt="VidBee" />
}
