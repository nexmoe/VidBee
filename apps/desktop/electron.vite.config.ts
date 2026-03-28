import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import Icons from 'unplugin-icons/vite'
import { loadEnv } from 'vite'

const bundledWorkspacePackages = ['@vidbee/db', '@vidbee/downloader-core', '@vidbee/i18n']
const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')
) as {
  version: string
}

const createTelemetryDefines = (mode: string): Record<string, string> => {
  const env = loadEnv(mode, process.cwd(), '')
  const release = env.VITE_GLITCHTIP_RELEASE || `vidbee-desktop@${packageJson.version}`
  const environment =
    env.VITE_GLITCHTIP_ENVIRONMENT || (mode === 'production' ? 'production' : mode)

  return {
    __GLITCHTIP_DSN__: JSON.stringify(env.VITE_GLITCHTIP_DSN || ''),
    __GLITCHTIP_ENVIRONMENT__: JSON.stringify(environment),
    __GLITCHTIP_RELEASE__: JSON.stringify(release)
  }
}

export default defineConfig(({ mode }) => {
  const define = createTelemetryDefines(mode)

  return {
    main: {
      define,
      build: {
        sourcemap: true
      },
      plugins: [
        externalizeDepsPlugin({
          exclude: bundledWorkspacePackages
        })
      ],
      resolve: {
        alias: {
          '@main': resolve('src/main'),
          '@shared': resolve('src/shared')
        }
      },
      assetsInclude: ['**/*.png', '**/*.ico', '**/*.icns'],
      publicDir: 'build'
    },
    preload: {
      define,
      build: {
        sourcemap: true
      },
      plugins: [
        externalizeDepsPlugin({
          exclude: bundledWorkspacePackages
        })
      ]
    },
    renderer: {
      base: './',
      define,
      build: {
        sourcemap: true
      },
      resolve: {
        alias: {
          '@main': resolve('src/main'),
          '@renderer': resolve('src/renderer/src'),
          '@shared': resolve('src/shared')
        }
      },
      plugins: [
        react(),
        Icons({
          compiler: 'jsx',
          jsx: 'react'
        }),
        tailwindcss()
      ]
    }
  }
})
