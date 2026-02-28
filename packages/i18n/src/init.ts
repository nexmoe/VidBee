import type { InitOptions, i18n as I18nInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { defaultLanguageCode, supportedLanguageCodes } from './languages'
import { translationResources } from './resources'

export const createI18nOptions = (): InitOptions => ({
  resources: translationResources,
  lng: defaultLanguageCode,
  fallbackLng: defaultLanguageCode,
  supportedLngs: supportedLanguageCodes,
  interpolation: {
    escapeValue: false
  }
})

export const initSharedI18n = async (instance: I18nInstance): Promise<I18nInstance> => {
  if (instance.isInitialized) {
    return instance
  }

  await instance.use(initReactI18next).init(createI18nOptions())
  return instance
}
