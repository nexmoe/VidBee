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
