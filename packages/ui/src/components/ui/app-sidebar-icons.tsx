import MingcuteChatFill from '~icons/mingcute/chat-3-fill'
import MingcuteChatLine from '~icons/mingcute/chat-3-line'
import MingcuteCheckCircleFill from '~icons/mingcute/check-circle-fill'
import MingcuteCheckCircleLine from '~icons/mingcute/check-circle-line'
import MingcuteDocumentsFill from '~icons/mingcute/documents-fill'
import MingcuteDocumentsLine from '~icons/mingcute/documents-line'
import MingcuteHome4Fill from '~icons/mingcute/home-4-fill'
import MingcuteHome4Line from '~icons/mingcute/home-4-line'
import MingcuteInformationFill from '~icons/mingcute/information-fill'
import MingcuteInformationLine from '~icons/mingcute/information-line'
import MingcuteRssFill from '~icons/mingcute/rss-fill'
import MingcuteRssLine from '~icons/mingcute/rss-line'
import MingcuteSettingsFill from '~icons/mingcute/settings-3-fill'
import MingcuteSettingsLine from '~icons/mingcute/settings-3-line'
import MingcuteToolFill from '~icons/mingcute/tool-fill'
import MingcuteToolLine from '~icons/mingcute/tool-line'
import type { AppSidebarIcon } from './app-sidebar'

interface AppSidebarIcons {
  chat: AppSidebarIcon
  home: AppSidebarIcon
  transcripts: AppSidebarIcon
  subscriptions: AppSidebarIcon
  supportedSites: AppSidebarIcon
  tools: AppSidebarIcon
  settings: AppSidebarIcon
  about: AppSidebarIcon
}

const appSidebarIcons: AppSidebarIcons = {
  chat: {
    active: MingcuteChatFill,
    inactive: MingcuteChatLine
  },
  home: {
    active: MingcuteHome4Fill,
    inactive: MingcuteHome4Line
  },
  transcripts: {
    active: MingcuteDocumentsFill,
    inactive: MingcuteDocumentsLine
  },
  subscriptions: {
    active: MingcuteRssFill,
    inactive: MingcuteRssLine
  },
  supportedSites: {
    active: MingcuteCheckCircleFill,
    inactive: MingcuteCheckCircleLine
  },
  tools: {
    active: MingcuteToolFill,
    inactive: MingcuteToolLine
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

export type { AppSidebarIcons }
export { appSidebarIcons }
