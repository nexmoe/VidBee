import { initSharedI18n } from '@vidbee/i18n'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// Pass the renderer's own react-i18next binding so useTranslation() and the
// i18next instance share the same module state (see initSharedI18n docs).
/** Keep document language and direction aligned with the selected UI locale. */
const syncLanguageDirection = () => {
  document.documentElement.lang = i18n.resolvedLanguage ?? i18n.language
  document.documentElement.dir = i18n.dir()
}

i18n.on('languageChanged', syncLanguageDirection)
void initSharedI18n(i18n, initReactI18next).then(syncLanguageDirection)

export default i18n
