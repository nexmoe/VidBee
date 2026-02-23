import type { AppSidebarIcon } from './app-sidebar'
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

interface AppSidebarIcons {
  home: AppSidebarIcon
  subscriptions: AppSidebarIcon
  supportedSites: AppSidebarIcon
  settings: AppSidebarIcon
  about: AppSidebarIcon
}

const appSidebarIcons: AppSidebarIcons = {
  home: {
    active: MingcuteDownload3Fill,
    inactive: MingcuteDownload3Line
  },
  subscriptions: {
    active: MingcuteRssFill,
    inactive: MingcuteRssLine
  },
  supportedSites: {
    active: MingcuteCheckCircleFill,
    inactive: MingcuteCheckCircleLine
  },
  settings: {
    active: MingcuteSettingsFill,
    inactive: MingcuteSettingsLine
  },
  about: {
    active: MingcuteInformationFill,
    inactive: MingcuteInformationLine
  }
}

export { appSidebarIcons }
export type { AppSidebarIcons }
