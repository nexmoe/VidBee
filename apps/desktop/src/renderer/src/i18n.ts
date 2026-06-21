import { initSharedI18n } from '@vidbee/i18n'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// Pass the renderer's own react-i18next binding so useTranslation() and the
// i18next instance share the same module state (see initSharedI18n docs).
void initSharedI18n(i18n, initReactI18next)

export default i18n
