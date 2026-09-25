export const COOKIE_BROWSER_IDS = [
  'chrome',
  'chromium',
  'firefox',
  'edge',
  'safari',
  'brave',
  'opera',
  'vivaldi',
  'whale'
] as const

export type CookieBrowserId = (typeof COOKIE_BROWSER_IDS)[number]

export type CookieSetupMethod = 'browser' | 'file'

export type CookieSetupReason =
  | 'windows-firefox'
  | 'windows-file'
  | 'detected-browser'
  | 'file-fallback'

export type CookieHealthStatus = 'unconfigured' | 'ok' | 'expired' | 'empty' | 'invalid'

export type CookieHealthSource = 'none' | 'browser' | 'file' | 'extension'

export type CookieHealthReason =
  | 'missing-file'
  | 'invalid-format'
  | 'expired'
  | 'no-session'
  | 'missing-profile'
  | 'missing-cookie-db'
  | 'macos-files-permission'
  | 'unsupported-browser'

export type CookieSetupFailureKind =
  | 'needed'
  | 'browser-locked'
  | 'browser-decrypt'
  | 'file-invalid'
  | 'linux-keyring'
  | 'macos-files-permission'
  | 'stale'

/** Canonical yt-dlp-adjacent error used when macOS TCC blocks cookie reads. */
export const MACOS_BROWSER_COOKIE_PERMISSION_MESSAGE =
  'macOS Files & Folders permission is required to read browser cookies'

export interface InstalledCookieBrowser {
  id: CookieBrowserId
  supported: boolean
}

export interface CookieSetupRecommendation {
  method: CookieSetupMethod
  browser?: CookieBrowserId
  reason: CookieSetupReason
}

export interface CookieSiteMatch {
  id: string
  label: string
  expired: boolean
}

export interface CookieHealth {
  status: CookieHealthStatus
  source: CookieHealthSource
  browser?: string
  cookiesPath?: string
  sites: CookieSiteMatch[]
  reason?: CookieHealthReason
}

/** Browser cookie row used to build a Netscape cookies.txt for yt-dlp. */
export interface NetscapeCookieInput {
  domain: string
  name: string
  value: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  hostOnly?: boolean
  session?: boolean
  expirationDate?: number
}

export const COOKIES_GUIDE_URL = 'https://vidbee.org/docs/cookies/'
export const COOKIES_CHROME_EXTENSION_URL =
  'https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc'
export const COOKIES_FIREFOX_EXTENSION_URL =
  'https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/'
export const VIDBEE_EXTENSION_ID = 'kpelcaehdkgleenlldpipjpoopnacehk'
export const VIDBEE_EXTENSION_ORIGIN = `chrome-extension://${VIDBEE_EXTENSION_ID}`
export const VIDBEE_EXTENSION_CHROME_URL = `https://chromewebstore.google.com/detail/${VIDBEE_EXTENSION_ID}`

const CHROMIUM_FAMILY_BROWSERS = new Set<CookieBrowserId>([
  'chrome',
  'chromium',
  'edge',
  'brave',
  'opera',
  'vivaldi',
  'whale'
])

const BROWSER_PREFERENCE: readonly CookieBrowserId[] = [
  'chrome',
  'edge',
  'brave',
  'firefox',
  'chromium',
  'vivaldi',
  'whale',
  'opera',
  'safari'
]

export const COOKIE_SITE_SPECS = [
  {
    id: 'youtube',
    label: 'YouTube',
    domainIncludes: ['youtube.com', 'google.com'],
    cookieNames: ['SID', 'LOGIN_INFO', 'SAPISID', '__Secure-1PSID', '__Secure-3PSID']
  },
  {
    id: 'bilibili',
    label: 'Bilibili',
    domainIncludes: ['bilibili.com'],
    cookieNames: ['SESSDATA', 'DedeUserID']
  },
  {
    id: 'instagram',
    label: 'Instagram',
    domainIncludes: ['instagram.com'],
    cookieNames: ['sessionid', 'ds_user_id']
  },
  {
    id: 'twitter',
    label: 'X',
    domainIncludes: ['x.com', 'twitter.com'],
    cookieNames: ['auth_token', 'ct0']
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    domainIncludes: ['tiktok.com'],
    cookieNames: ['sessionid', 'sid_guard', 'sessionid_ss']
  },
  {
    id: 'facebook',
    label: 'Facebook',
    domainIncludes: ['facebook.com'],
    cookieNames: ['c_user', 'xs']
  },
  {
    id: 'twitch',
    label: 'Twitch',
    domainIncludes: ['twitch.tv'],
    cookieNames: ['auth-token']
  },
  {
    id: 'reddit',
    label: 'Reddit',
    domainIncludes: ['reddit.com'],
    cookieNames: ['reddit_session']
  },
  {
    id: 'douyin',
    label: 'Douyin',
    domainIncludes: ['douyin.com'],
    cookieNames: ['sessionid', 'sid_guard']
  }
] as const

const HTTPONLY_DOMAIN_PREFIX = '#HttpOnly_'
const MAX_COOKIES_FILE_BYTES = 2_000_000

const NEEDED_PATTERNS = [
  'sign in to confirm your age',
  "sign in to confirm you're not a bot",
  'sign in to confirm you’re not a bot',
  'login required',
  'private video',
  'members-only',
  'please log in',
  'please sign in'
]
const STALE_PATTERNS = ['cookies are no longer valid', 'http error 403: forbidden']
const BROWSER_LOCKED_PATTERNS = [
  'could not copy chrome cookie database',
  'could not copy chromium cookie database',
  'could not copy edge cookie database'
]
const COOKIE_DB_MISSING_PATTERN = /could not find [a-z]+ cookies database/
const COOKIE_DB_MISSING_PATTERNS = [
  'custom safari cookies database not found',
  'could not find chrome cookies database',
  'could not find chromium cookies database',
  'could not find firefox cookies database',
  'could not find edge cookies database',
  'could not find safari cookies database',
  'could not find brave cookies database',
  'could not find opera cookies database',
  'could not find vivaldi cookies database',
  'could not find whale cookies database'
]
const BROWSER_DECRYPT_PATTERNS = ['failed to decrypt with dpapi']
const FILE_INVALID_PATTERNS = [
  "utf-8' codec can't decode byte",
  'cookies file must be netscape formatted',
  'does not look like a netscape format cookies file'
]
const LINUX_KEYRING_PATTERNS = ['secretstorage not available']

/**
 * True when yt-dlp can read cookies from this browser on the given OS.
 *
 * @param platform Node `os.platform()` value.
 * @param browser Browser id from settings.
 */
export const isBrowserCookieReadSupported = (platform: string, browser: string): boolean => {
  if (!browser || browser === 'none') {
    return false
  }
  if (!isCookieBrowserId(browser)) {
    return false
  }
  if (browser === 'safari') {
    return platform === 'darwin'
  }
  if (platform === 'win32') {
    return browser === 'firefox'
  }
  return true
}

/**
 * True when the id is a known cookies-from-browser target.
 *
 * @param value Candidate browser id.
 */
export const isCookieBrowserId = (value: string): value is CookieBrowserId =>
  (COOKIE_BROWSER_IDS as readonly string[]).includes(value)

/**
 * Browsers the settings picker should offer for `--cookies-from-browser`.
 *
 * @param platform Node `os.platform()` value.
 */
export const listSelectableCookieBrowsers = (platform: string): CookieBrowserId[] =>
  COOKIE_BROWSER_IDS.filter((id) => isBrowserCookieReadSupported(platform, id))

/**
 * True when the value is a Chromium-family browser that Windows cannot read.
 *
 * @param browser Browser id from settings.
 */
export const isWindowsBlockedCookieBrowser = (browser: string): boolean =>
  isCookieBrowserId(browser) && CHROMIUM_FAMILY_BROWSERS.has(browser)

/**
 * Recommend a single cookie setup path from OS and installed browsers.
 *
 * @param input Platform plus browsers detected on disk.
 */
export const recommendCookieSetup = (input: {
  platform: string
  installedBrowsers: readonly InstalledCookieBrowser[]
}): CookieSetupRecommendation => {
  const supportedInstalled = input.installedBrowsers
    .filter((entry) => entry.supported && isBrowserCookieReadSupported(input.platform, entry.id))
    .map((entry) => entry.id)

  if (input.platform === 'win32') {
    if (supportedInstalled.includes('firefox')) {
      return { method: 'browser', browser: 'firefox', reason: 'windows-firefox' }
    }
    return { method: 'file', reason: 'windows-file' }
  }

  for (const browser of BROWSER_PREFERENCE) {
    if (supportedInstalled.includes(browser)) {
      return { method: 'browser', browser, reason: 'detected-browser' }
    }
  }

  return { method: 'file', reason: 'file-fallback' }
}

/**
 * True when settings currently point at a browser or cookies file.
 *
 * @param browserForCookies Raw `browserForCookies` setting.
 * @param cookiesPath Raw `cookiesPath` setting.
 */
export const hasConfiguredCookieSettings = (
  browserForCookies: string | undefined,
  cookiesPath: string | undefined
): boolean => {
  const trimmedPath = cookiesPath?.trim()
  if (trimmedPath) {
    return true
  }
  const trimmedBrowser = browserForCookies?.trim()
  return Boolean(trimmedBrowser && trimmedBrowser !== 'none')
}

/**
 * Health record used when nothing is configured yet.
 */
export const unconfiguredCookieHealth = (): CookieHealth => ({
  source: 'none',
  status: 'unconfigured',
  sites: []
})

/**
 * Parse a Netscape cookies.txt body and report login-cookie health.
 *
 * @param text File contents.
 * @param cookiesPath Optional path to echo back.
 */
export const inspectNetscapeCookies = (text: string, cookiesPath?: string): CookieHealth => {
  if (!looksLikeNetscapeCookies(text)) {
    return {
      cookiesPath,
      reason: 'invalid-format',
      source: 'file',
      status: 'invalid',
      sites: []
    }
  }

  const cookies = parseNetscapeCookieLines(text)
  if (cookies.length === 0) {
    return {
      cookiesPath,
      reason: 'no-session',
      source: 'file',
      status: 'empty',
      sites: []
    }
  }

  const sites = matchCookieSites(cookies)
  if (sites.some((site) => !site.expired)) {
    return {
      cookiesPath,
      source: 'file',
      status: 'ok',
      sites: sites.filter((site) => !site.expired)
    }
  }
  if (sites.some((site) => site.expired)) {
    return {
      cookiesPath,
      reason: 'expired',
      source: 'file',
      status: 'expired',
      sites
    }
  }

  return {
    cookiesPath,
    reason: 'no-session',
    source: 'file',
    status: 'empty',
    sites: []
  }
}

/**
 * Map cookie domain/name rows onto the supported signed-in sites.
 *
 * @param cookies Domain, name, and expiry rows.
 */
export const matchCookieSites = (
  cookies: readonly { domain: string; name: string; expires: number }[]
): CookieSiteMatch[] => {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const sites: CookieSiteMatch[] = []
  for (const spec of COOKIE_SITE_SPECS) {
    const matches = cookies.filter(
      (cookie) =>
        spec.domainIncludes.some((domain) => cookieDomainMatches(cookie.domain, domain)) &&
        spec.cookieNames.some((name) => name === cookie.name)
    )
    if (matches.length === 0) {
      continue
    }
    const hasFresh = matches.some((cookie) => cookie.expires === 0 || cookie.expires > nowSeconds)
    sites.push({ expired: !hasFresh, id: spec.id, label: spec.label })
  }
  return sites
}

/**
 * Cookie lookup domains for a download URL, including sibling auth hosts.
 *
 * @param url Download or watch URL.
 */
export const cookieDomainsForUrl = (url: string): string[] => {
  let hostname = ''
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return []
    }
    hostname = parsed.hostname.toLowerCase()
  } catch {
    return []
  }
  if (!hostname) {
    return []
  }

  const domains = new Set<string>()
  for (const spec of COOKIE_SITE_SPECS) {
    if (spec.domainIncludes.some((domain) => cookieDomainMatches(hostname, domain))) {
      for (const fragment of spec.domainIncludes) {
        domains.add(fragment)
      }
    }
  }
  if (domains.size > 0) {
    return [...domains]
  }

  // Keep unknown hosts exact; guessing a registrable domain can expose sibling sites.
  return [hostname]
}

/** Match a cookie host to a domain boundary, never an arbitrary substring. */
export function cookieDomainMatches(host: string, domain: string): boolean {
  const normalized = host.toLowerCase().replace(/^\./, '')
  const normalizedDomain = domain.toLowerCase().replace(/^\./, '')
  return (
    Boolean(normalizedDomain) &&
    (normalized === normalizedDomain || normalized.endsWith(`.${normalizedDomain}`))
  )
}

/** Accept configured auth hosts and parent-domain cookies applicable to the requested URL. */
export function cookieMatchesUrlScope(cookieDomain: string, url: string): boolean {
  const domains = cookieDomainsForUrl(url)
  if (domains.length === 0) {
    return false
  }
  return (
    domains.some((domain) => cookieDomainMatches(cookieDomain, domain)) ||
    cookieDomainMatches(new URL(url).hostname, cookieDomain)
  )
}

/**
 * Serialize browser cookie rows to a Netscape cookies.txt body for yt-dlp.
 *
 * @param cookies Cookie rows from the browser extension.
 */
export const serializeNetscapeCookies = (cookies: readonly NetscapeCookieInput[]): string => {
  const lines = ['# Netscape HTTP Cookie File', '# This file was generated by VidBee', '']
  for (const cookie of cookies) {
    const name = sanitizeNetscapeField(cookie.name)
    const value = sanitizeNetscapeField(cookie.value)
    if (!name) {
      continue
    }
    const rawDomain = cookie.domain.trim().toLowerCase()
    if (!rawDomain) {
      continue
    }
    const dotted = cookie.hostOnly || rawDomain.startsWith('.') ? rawDomain : `.${rawDomain}`
    const includeSubdomains = dotted.startsWith('.') ? 'TRUE' : 'FALSE'
    const domainField = cookie.httpOnly ? `${HTTPONLY_DOMAIN_PREFIX}${dotted}` : dotted
    const expires =
      cookie.session || !cookie.expirationDate ? '0' : String(Math.floor(cookie.expirationDate))
    const path = cookie.path?.trim() || '/'
    const secure = cookie.secure ? 'TRUE' : 'FALSE'
    lines.push([domainField, includeSubdomains, path, secure, expires, name, value].join('\t'))
  }
  return `${lines.join('\n')}\n`
}

/**
 * Strip Netscape field separators from a cookie name or value.
 *
 * @param value Raw cookie field.
 */
const sanitizeNetscapeField = (value: string): string => value.replace(/[\t\r\n]/g, '')

/**
 * True when the sample looks like a Netscape cookies export rather than a DB.
 *
 * @param text File text sample.
 */
export const looksLikeNetscapeCookies = (text: string): boolean => {
  const sample = text.slice(0, 4096)
  return (
    sample.includes('# Netscape HTTP Cookie File') ||
    sample.includes('# HTTP Cookie File') ||
    /^(?:#HttpOnly_)?[^\s\t]+\t(?:TRUE|FALSE)\t/im.test(sample)
  )
}

/**
 * Maximum cookies.txt size we will inspect.
 */
export const getMaxCookiesFileBytes = (): number => MAX_COOKIES_FILE_BYTES

/**
 * True when the error text points at a macOS browser-cookie path.
 *
 * @param normalized Lowercased error text.
 */
const looksLikeMacosCookiePath = (normalized: string): boolean =>
  normalized.includes('/library/application support/') ||
  normalized.includes('/library/containers/') ||
  normalized.includes('/library/safari') ||
  normalized.includes('/library/cookies')

/**
 * True when yt-dlp could not locate a browser cookies database.
 *
 * @param normalized Lowercased error text.
 */
const isCookieDatabaseMissingError = (normalized: string): boolean =>
  COOKIE_DB_MISSING_PATTERN.test(normalized) ||
  COOKIE_DB_MISSING_PATTERNS.some((pattern) => normalized.includes(pattern))

/**
 * Map a yt-dlp error to a cookie-setup recovery kind, or null when unrelated.
 *
 * @param rawError Raw stderr or stored download error.
 */
export const getCookieSetupFailureKind = (
  rawError: string | null | undefined
): CookieSetupFailureKind | null => {
  const normalized = rawError?.trim().toLowerCase() ?? ''
  if (!normalized) {
    return null
  }
  if (LINUX_KEYRING_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return 'linux-keyring'
  }
  if (BROWSER_DECRYPT_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return 'browser-decrypt'
  }
  if (
    normalized.includes('files & folders permission is required') ||
    (isCookieDatabaseMissingError(normalized) && looksLikeMacosCookiePath(normalized))
  ) {
    return 'macos-files-permission'
  }
  if (
    BROWSER_LOCKED_PATTERNS.some((pattern) => normalized.includes(pattern)) ||
    isCookieDatabaseMissingError(normalized)
  ) {
    return 'browser-locked'
  }
  if (FILE_INVALID_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return 'file-invalid'
  }
  if (STALE_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return 'stale'
  }
  if (NEEDED_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return 'needed'
  }
  return null
}

interface ParsedNetscapeCookie {
  domain: string
  name: string
  expires: number
}

/**
 * Parse Netscape cookie rows from a cookies.txt body.
 *
 * @param text File contents.
 */
const parseNetscapeCookieLines = (text: string): ParsedNetscapeCookie[] => {
  const cookies: ParsedNetscapeCookie[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || (line.startsWith('#') && !line.startsWith(HTTPONLY_DOMAIN_PREFIX))) {
      continue
    }
    const fields = line.split('\t')
    const domainField = fields[0]
    const expiresField = fields[4]
    const nameField = fields[5]
    if (fields.length < 7 || domainField === undefined || nameField === undefined) {
      continue
    }
    const domain = domainField.startsWith(HTTPONLY_DOMAIN_PREFIX)
      ? domainField.slice(HTTPONLY_DOMAIN_PREFIX.length)
      : domainField
    const expires = Number.parseInt(expiresField ?? '', 10)
    cookies.push({
      domain: domain.toLowerCase(),
      expires: Number.isFinite(expires) ? expires : 0,
      name: nameField
    })
  }
  return cookies
}
