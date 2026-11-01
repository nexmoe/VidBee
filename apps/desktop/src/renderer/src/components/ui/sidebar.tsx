import { AppSidebar, type AppSidebarItem } from '@vidbee/ui/components/ui/app-sidebar'
import { appSidebarIcons } from '@vidbee/ui/components/ui/app-sidebar-icons'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import '../../assets/title-bar.css'
import { agentApprovalPendingAtom } from '@renderer/store/agent-tasks'
import { updateAvailableAtom } from '@renderer/store/update'

type Page = 'about' | 'chat' | 'home' | 'settings' | 'subscriptions'

interface SidebarProps {
  currentPage: Page
  onPageChange: (page: Page) => void
  onOpenTools: () => void
  transcriptsActive?: boolean
}

/**
 * Render the desktop navigation sidebar.
 */
export function Sidebar({
  currentPage,
  onPageChange,
  onOpenTools,
  transcriptsActive = false
}: SidebarProps) {
  const { t } = useTranslation()
  const updateAvailable = useAtomValue(updateAvailableAtom)
  const approvalPending = useAtomValue(agentApprovalPendingAtom)

  const items: AppSidebarItem[] = [
    {
      id: 'home',
      active: currentPage === 'home',
      icon: appSidebarIcons.home,
      indicator: transcriptsActive,
      label: t('menu.home'),
      onClick: () => onPageChange('home')
    },
    {
      id: 'chat',
      active: currentPage === 'chat',
      icon: appSidebarIcons.chat,
      indicator: approvalPending,
      label: t('transcript.promptHistoryChat'),
      onClick: () => onPageChange('chat')
    },
    {
      id: 'subscriptions',
      active: currentPage === 'subscriptions',
      icon: appSidebarIcons.subscriptions,
      label: t('menu.rss'),
      onClick: () => onPageChange('subscriptions')
    },
    {
      id: 'tools',
      icon: appSidebarIcons.tools,
      label: t('menu.tools'),
      onClick: onOpenTools
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
