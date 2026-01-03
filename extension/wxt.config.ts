import { defineConfig } from 'wxt'

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    default_locale: 'en',
    host_permissions: ['http://127.0.0.1/*'],
    permissions: ['activeTab', 'storage']
  }
})
