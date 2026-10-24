import type { CookieSiteMatch, NetscapeCookieInput } from '@vidbee/downloader-core/cookie-setup'

/** Remembered browser profiles in cookie priority order, without credentials. */
export interface ExtensionCookieSourcePreference {
  id: string
  browser: string
}

/** One remembered extension, retained in Settings even while it is offline. */
export interface ExtensionCookieSource extends ExtensionCookieSourcePreference {
  connected: boolean
  lastSeenAt?: number
  sites: CookieSiteMatch[]
}

/** Live browser-extension cookie bridge shown on the cookies settings page. */
export interface ExtensionCookieConnection {
  connected: boolean
  browser?: string
  lastSeenAt?: number
  sites: CookieSiteMatch[]
  activeSourceId?: string
  sources: ExtensionCookieSource[]
}

/** Cookie rows the extension posts back for one download URL. */
export type ExtensionCookieRow = NetscapeCookieInput
