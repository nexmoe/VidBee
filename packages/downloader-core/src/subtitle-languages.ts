export const FOLLOW_INTERFACE_SUBTITLE_LANGUAGE = 'interface'
export const MAX_SUBTITLE_LANGUAGES = 5
export const DEFAULT_SUBTITLE_LANGUAGES = [FOLLOW_INTERFACE_SUBTITLE_LANGUAGE] as const

const SUBTITLE_LANGUAGE_CODE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i

const SUBTITLE_LANGUAGE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  ar: ['ar-SA', 'ar_SA', 'ara'],
  de: ['de-DE', 'de_DE', 'deu', 'ger'],
  en: ['en-US', 'en_US', 'en-GB', 'en_GB', 'eng'],
  es: ['es-ES', 'es_ES', 'es-419', 'es_419', 'spa'],
  fr: ['fr-FR', 'fr_FR', 'fra', 'fre'],
  id: ['id-ID', 'id_ID', 'ind'],
  it: ['it-IT', 'it_IT', 'ita'],
  ja: ['ja-JP', 'ja_JP', 'jpn'],
  ko: ['ko-KR', 'ko_KR', 'kor'],
  pt: ['pt-BR', 'pt_BR', 'pt-PT', 'pt_PT', 'por'],
  ru: ['ru-RU', 'ru_RU', 'rus'],
  tr: ['tr-TR', 'tr_TR', 'tur'],
  'zh-hans': ['zh', 'zh-CN', 'zh_CN', 'zho', 'chi'],
  'zh-hant': ['zh-TW', 'zh_TW', 'zh-HK', 'zh_HK']
}

/**
 * Convert an app locale into the closest subtitle language code used by yt-dlp.
 *
 * @param language VidBee locale or explicit subtitle language.
 * @returns A normalized subtitle language code.
 */
export const interfaceSubtitleLanguage = (language: string | null | undefined): string => {
  const normalized = language?.trim().replaceAll('_', '-') || 'en'
  const lower = normalized.toLowerCase()

  if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo' || lower === 'zh-hant') {
    return 'zh-Hant'
  }
  if (lower === 'zh' || lower === 'zh-cn' || lower === 'zh-sg' || lower === 'zh-hans') {
    return 'zh-Hans'
  }

  return normalized
}

/**
 * Sanitize persisted subtitle preferences and keep request volume bounded.
 *
 * @param languages Persisted language codes or the interface-language token.
 * @returns Valid, de-duplicated preferences with a safe default.
 */
export const normalizeSubtitleLanguages = (
  languages: readonly string[] | null | undefined
): string[] => {
  const normalized: string[] = []
  const seen = new Set<string>()

  for (const language of languages ?? []) {
    const trimmed = language.trim()
    const isInterfaceLanguage = trimmed === FOLLOW_INTERFACE_SUBTITLE_LANGUAGE
    const isReservedAllPattern = trimmed.toLowerCase() === 'all'
    if (isReservedAllPattern || !(isInterfaceLanguage || SUBTITLE_LANGUAGE_CODE.test(trimmed))) {
      continue
    }

    const key = trimmed.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    normalized.push(trimmed)

    if (normalized.length >= MAX_SUBTITLE_LANGUAGES) {
      break
    }
  }

  return normalized.length > 0 ? normalized : [...DEFAULT_SUBTITLE_LANGUAGES]
}

/**
 * Resolve dynamic preferences into exact yt-dlp subtitle language codes.
 *
 * @param languages Persisted subtitle language preferences.
 * @param interfaceLanguage Current VidBee interface language.
 * @returns Exact language codes, de-duplicated after interface-language expansion.
 */
export const resolveSubtitleLanguages = (
  languages: readonly string[] | null | undefined,
  interfaceLanguage: string | null | undefined
): string[] => {
  const resolved: string[] = []
  const seen = new Set<string>()

  for (const preference of normalizeSubtitleLanguages(languages)) {
    const language = interfaceSubtitleLanguage(
      preference === FOLLOW_INTERFACE_SUBTITLE_LANGUAGE ? interfaceLanguage : preference
    )
    const key = language.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    resolved.push(language)
  }

  return resolved
}

/**
 * Expand canonical preferences into common extractor-specific subtitle tags.
 *
 * Platforms frequently expose locale (`en_US`), regional (`pt-BR`), or ISO-639-2
 * (`eng`) tags instead of VidBee's canonical language code. Exact aliases keep
 * matching bounded without using broad regexes that may download duplicate tracks.
 *
 * @param languages Canonical subtitle language codes.
 * @returns De-duplicated canonical codes followed by known platform aliases.
 */
export const expandSubtitleLanguageAliases = (languages: readonly string[]): string[] => {
  const expanded = new Map<string, string>()

  for (const language of languages) {
    expanded.set(language.toLowerCase(), language)
    const key = language.trim().replaceAll('_', '-').toLowerCase()
    const aliasKey = key.startsWith('zh-') ? key : (key.split('-')[0] ?? key)
    for (const alias of SUBTITLE_LANGUAGE_ALIASES[aliasKey] ?? []) {
      expanded.set(alias.toLowerCase(), alias)
    }
  }

  return [...expanded.values()]
}
