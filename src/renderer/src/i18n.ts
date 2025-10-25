import { defaultLanguageCode, supportedLanguageCodes } from '@shared/languages'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zh from './locales/zh.json'

const resources = Object.fromEntries(
  supportedLanguageCodes.map((code) => [
    code,
    {
      translation: code === 'zh' || code === 'zh-TW' ? zh : en
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
