export interface LanguageDefinition {
  flag: string
  name: string
  hreflang: string
}

export const languages = {
  en: {
    flag: 'fi fi-us',
    name: 'English',
    hreflang: 'en'
  },
  es: {
    flag: 'fi fi-es',
    name: 'Español',
    hreflang: 'es'
  },
  ar: {
    flag: 'fi fi-sa',
    name: 'العربية',
    hreflang: 'ar'
  },
  id: {
    flag: 'fi fi-id',
    name: 'Bahasa Indonesia',
    hreflang: 'id'
  },
  pt: {
    flag: 'fi fi-br',
    name: 'Português',
    hreflang: 'pt-BR'
  },
  fr: {
    flag: 'fi fi-fr',
    name: 'Français',
    hreflang: 'fr'
  },
  it: {
    flag: 'fi fi-it',
    name: 'Italiano',
    hreflang: 'it'
  },
  zh: {
    flag: 'fi fi-cn',
    name: '中文',
    hreflang: 'zh-CN'
  },
  'zh-TW': {
    flag: 'fi fi-tw',
    name: '繁體中文',
    hreflang: 'zh-TW'
  },
  ko: {
    flag: 'fi fi-kr',
    name: '한국어',
    hreflang: 'ko'
  },
  ja: {
    flag: 'fi fi-jp',
    name: '日本語',
    hreflang: 'ja'
  },
  ru: {
    flag: 'fi fi-ru',
    name: 'Русский',
    hreflang: 'ru'
  },
  de: {
    flag: 'fi fi-de',
    name: 'Deutsch',
    hreflang: 'de'
  }
} as const satisfies Record<string, LanguageDefinition>

export type LanguageCode = keyof typeof languages

export const defaultLanguageCode: LanguageCode = 'en'

export const languageList = Object.entries(languages).map(([code, definition]) => ({
  value: code as LanguageCode,
  ...definition
}))

export const supportedLanguageCodes = languageList.map((language) => language.value)

export function normalizeLanguageCode(code: string | null | undefined): LanguageCode {
  if (!code) {
    return defaultLanguageCode
  }

  const normalizedInput = code.toLowerCase()
  const directMatch = supportedLanguageCodes.find(
    (languageCode) => languageCode.toLowerCase() === normalizedInput
  )
  if (directMatch) {
    return directMatch
  }

  const base = normalizedInput.split('-')[0] ?? ''
  const baseMatch = supportedLanguageCodes.find(
    (languageCode) => languageCode.split('-')[0]?.toLowerCase() === base
  )

  return baseMatch ?? defaultLanguageCode
}
