import { defaultLanguageCode, supportedLanguageCodes } from '@shared/languages'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'

type TranslationDictionary = typeof en

const localeModules = import.meta.glob<{ default: TranslationDictionary }>('./locales/*.json', {
  eager: true
})

const translations = Object.fromEntries(
  Object.entries(localeModules).map(([path, module]) => {
    const code = path.replace('./locales/', '').replace('.json', '')
    return [code, module.default]
  })
) as Record<string, TranslationDictionary>

const resources = Object.fromEntries(
  supportedLanguageCodes.map((code) => [
    code,
    {
      translation: translations[code] ?? en
    }
  ])
)

i18n.use(initReactI18next).init({
  resources,
  lng: defaultLanguageCode,
  fallbackLng: defaultLanguageCode,
  supportedLngs: supportedLanguageCodes,
  interpolation: {
    escapeValue: false
  }
})

export default i18n
