import type { CookieSiteMatch, NetscapeCookieInput } from '@vidbee/downloader-core/cookie-setup'

/** Live browser-extension cookie bridge shown on the cookies settings page. */
export interface ExtensionCookieConnection {
  connected: boolean
  browser?: string
  lastSeenAt?: number
  sites: CookieSiteMatch[]
}

/** Cookie rows the extension posts back for one download URL. */
export type ExtensionCookieRow = NetscapeCookieInput
