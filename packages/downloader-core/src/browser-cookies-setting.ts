import path from 'node:path'

export interface BrowserCookiesSetting {
  browser: string
  profile: string
}

const normalizeProfileInput = (value: string): string => value.trim().replace(/^['"]|['"]$/g, '')

export const parseBrowserCookiesSetting = (value: string | undefined): BrowserCookiesSetting => {
  if (!value || value === 'none') {
    return { browser: 'none', profile: '' }
  }

  const separatorIndex = value.indexOf(':')
  if (separatorIndex === -1) {
    return { browser: value, profile: '' }
  }

  const browser = value.slice(0, separatorIndex).trim()
  const profile = normalizeProfileInput(value.slice(separatorIndex + 1))
  return { browser: browser || 'none', profile }
}

export const buildBrowserCookiesSetting = (browser: string, profile: string): string => {
  const trimmedBrowser = browser.trim()
  if (!trimmedBrowser || trimmedBrowser === 'none') {
    return 'none'
  }

  const trimmedProfile = normalizeProfileInput(profile)
  return trimmedProfile ? `${trimmedBrowser}:${trimmedProfile}` : trimmedBrowser
}

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/

const toYtDlpProfile = (profile: string): string => {
  const trimmedProfile = normalizeProfileInput(profile).replace(/[\\/]+$/g, '')
  if (!trimmedProfile) {
    return ''
  }

  if (path.isAbsolute(trimmedProfile) || WINDOWS_ABSOLUTE_PATH_PATTERN.test(trimmedProfile)) {
    return path.posix.basename(trimmedProfile.replace(/\\/g, '/'))
  }

  return trimmedProfile
}

export const resolveBrowserCookiesArg = (value: string | undefined): string | undefined => {
  const { browser, profile } = parseBrowserCookiesSetting(value)
  if (!browser || browser === 'none') {
    return undefined
  }

  if (browser === 'safari') {
    return 'safari'
  }

  const ytDlpProfile = toYtDlpProfile(profile)
  return ytDlpProfile ? `${browser}:${ytDlpProfile}` : browser
}
