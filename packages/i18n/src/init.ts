import type { InitOptions, i18n as I18nInstance, ThirdPartyModule } from 'i18next'
import { defaultLanguageCode, supportedLanguageCodes } from './languages'
import { translationResources } from './resources'

/**
 * Build the shared i18next options (resources, default/fallback language).
 */
export const createI18nOptions = (): InitOptions => ({
  resources: translationResources,
  lng: defaultLanguageCode,
  fallbackLng: defaultLanguageCode,
  supportedLngs: supportedLanguageCodes,
  interpolation: {
    escapeValue: false
  }
})

/**
 * Initialize a shared i18next instance with the consumer's own React binding.
 *
 * The `reactBinding` (react-i18next's `initReactI18next`) MUST come from the
 * consuming app's own `react-i18next` copy. Importing it inside this package
 * resolves a separate physical react-i18next instance (peer-dependency
 * duplication in the workspace), so `setI18n()` and `useTranslation()` would
 * bind to different module state and every key would render untranslated.
 */
export const initSharedI18n = async (
  instance: I18nInstance,
  reactBinding: ThirdPartyModule
): Promise<I18nInstance> => {
  if (instance.isInitialized) {
    return instance
  }

  await instance.use(reactBinding).init(createI18nOptions())
  return instance
}
