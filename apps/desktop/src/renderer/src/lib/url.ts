import { type LanguageCode, normalizeLanguageCode } from '@vidbee/i18n/languages'

const VIDBEE_ORIGIN = import.meta.env.DEV
  ? import.meta.env.VITE_VIDBEE_HOME_URL || 'http://localhost:4321'
  : 'https://vidbee.org'
const UTM_SOURCE = 'vidbee-desktop'
const UTM_MEDIUM = 'app'

const WEBSITE_LOCALE_PREFIXES: Record<LanguageCode, string> = {
  ar: 'ar',
  de: 'de',
  en: '',
  es: 'es',
  fr: 'fr',
  id: 'id',
  it: 'it',
  ja: 'ja',
  ko: 'ko',
  pt: 'pt',
  ru: 'ru',
  tr: '',
  zh: 'zh',
  'zh-TW': 'zh-tw'
}

/**
 * Build a website URL that follows the current desktop language.
 * Development opens the local home app. Production uses vidbee.org.
 * Languages unavailable on the website fall back to the unprefixed English route.
 * @param pathname - Website pathname, with or without a leading slash
 * @param language - Current desktop language code
 * @returns Localized absolute website URL
 */
export function buildLocalizedVidBeeUrl(pathname: string, language: string): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`
  const localePrefix = WEBSITE_LOCALE_PREFIXES[normalizeLanguageCode(language)]
  const localizedPath = localePrefix ? `/${localePrefix}${normalizedPath}` : normalizedPath
  return new URL(localizedPath, VIDBEE_ORIGIN).toString()
}

/**
 * Append desktop UTM parameters to any absolute URL.
 * @param url - Target URL to tag
 * @returns URL with utm_source/utm_medium, or the original string if parsing fails
 */
export function withDesktopCampaignUtm(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('utm_source', UTM_SOURCE)
    parsed.searchParams.set('utm_medium', UTM_MEDIUM)
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * Append UTM parameters to vidbee.org URLs opened from the desktop app.
 * Non-vidbee.org URLs and unparseable strings are returned unchanged.
 * @param url - Target URL to tag
 * @returns URL with utm_source/utm_medium when the host is vidbee.org or a subdomain
 */
export function withDesktopUtm(url: string): string {
  try {
    const parsed = new URL(url)
    const isVidbeeHost = parsed.hostname === 'vidbee.org' || parsed.hostname.endsWith('.vidbee.org')
    if (!isVidbeeHost) {
      return url
    }
    return withDesktopCampaignUtm(url)
  } catch {
    return url
  }
}
