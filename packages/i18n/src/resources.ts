import type { Resource } from 'i18next'
import ar from './locales/ar.json'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import id from './locales/id.json'
import it from './locales/it.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import pt from './locales/pt.json'
import ru from './locales/ru.json'
import tr from './locales/tr.json'
import zhTw from './locales/zh-TW.json'
import zh from './locales/zh.json'
import { type LanguageCode, supportedLanguageCodes } from './languages'

export type TranslationDictionary = typeof en

const translationDictionaries: Record<LanguageCode, TranslationDictionary> = {
  ar,
  de,
  en,
  es,
  fr,
  id,
  it,
  ja,
  ko,
  pt,
  ru,
  tr,
  'zh-TW': zhTw,
  zh
}

export const translationResources: Resource = Object.fromEntries(
  supportedLanguageCodes.map((code) => [
    code,
    {
      translation: translationDictionaries[code] ?? en
    }
  ])
)
