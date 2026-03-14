import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import Icons from 'unplugin-icons/vite'

const bundledWorkspacePackages = ['@vidbee/db', '@vidbee/downloader-core', '@vidbee/i18n']

export default defineConfig({
  main: {
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
    plugins: [
      externalizeDepsPlugin({
        exclude: bundledWorkspacePackages
      })
    ]
  },
  renderer: {
    base: './',
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
})
