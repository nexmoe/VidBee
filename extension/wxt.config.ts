import { defineConfig } from 'wxt'

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    host_permissions: ['http://*/*', 'https://*/*'],
    permissions: ['activeTab', 'storage', 'cookies', 'downloads']
  },
  webExt: {
    chromiumProfile: '.context/wxt-profiles/chromium',
    firefoxProfile: '.context/wxt-profiles/firefox',
    keepProfileChanges: true
  }
})
