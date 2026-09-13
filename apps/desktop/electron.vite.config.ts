import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { FileSystemIconLoader } from 'unplugin-icons/loaders'
import Icons from 'unplugin-icons/vite'
import { loadEnv } from 'vite'
import { createRendererResolve } from './renderer-react-resolve'

const require = createRequire(import.meta.url)
const lobeIconsDir = join(
  dirname(require.resolve('@lobehub/icons-static-svg/package.json')),
  'icons'
)
const streamdownMermaidDir = dirname(
  realpathSync(join(import.meta.dirname, 'node_modules/@streamdown/mermaid/package.json'))
)
const mermaidRoot = dirname(
  require.resolve('mermaid/package.json', {
    paths: [dirname(streamdownMermaidDir)]
  })
)
const mermaidBundledEntry = join(mermaidRoot, 'dist/mermaid.esm.min.mjs')
const beautifulMermaidDir = dirname(
  realpathSync(join(import.meta.dirname, 'node_modules/beautiful-mermaid/package.json'))
)
const elkBundledEntry = require.resolve('elkjs/lib/elk.bundled.js', {
  paths: [dirname(beautifulMermaidDir)]
})

const bundledWorkspacePackages = [
  '@vidbee/db',
  '@vidbee/downloader-core',
  '@vidbee/i18n',
  '@vidbee/logger',
  '@vidbee/task-queue',
  '@vidbee/subscriptions-core',
  '@vidbee/transcription',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-telemetry'
]
const nativeRuntimeExternals = ['electron', 'better-sqlite3', 'sherpa-onnx-node'] as const
const nativeRuntimeExternalMatchers: Array<string | RegExp> = [
  ...nativeRuntimeExternals,
  /^electron\//,
  /^@earendil-works\/pi-coding-agent(?:\/|$)/,
  /^sherpa-onnx-/
]

/**
 * Keep Electron, better-sqlite3, and sherpa native addons unbundled.
 * Bundling them rewrites `__dirname` so `.node` files resolve under `out/`.
 * @param {string} id
 * @returns {boolean}
 */
const shouldExternalizeNativeRuntime = (id: string): boolean =>
  nativeRuntimeExternals.some((name) => id === name || id.startsWith(`${name}/`)) ||
  id.startsWith('electron/') ||
  id.startsWith('sherpa-onnx-')
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
  const portlessUrl = mode === 'development' ? process.env.PORTLESS_URL : undefined
  if (portlessUrl) {
    define['import.meta.env.VITE_VIDBEE_HOME_URL'] = JSON.stringify(
      portlessUrl.replace('desktop.vidbee.', 'home.vidbee.')
    )
  }
  const rendererResolve = createRendererResolve(import.meta.dirname)

  return {
    main: {
      define,
      ssr: {
        external: [...nativeRuntimeExternals]
      },
      build: {
        sourcemap: true,
        rollupOptions: {
          input: {
            index: resolve(import.meta.dirname, 'src/main/index.ts'),
            'transcription-worker': resolve(
              import.meta.dirname,
              '../../packages/transcription/src/worker/entry.ts'
            )
          },
          output: {
            format: 'cjs',
            entryFileNames: '[name].js'
          },
          external: nativeRuntimeExternalMatchers
        },
        externalizeDeps: {
          exclude: bundledWorkspacePackages
        }
      },
      plugins: [
        {
          name: 'externalize-native-runtime',
          enforce: 'pre',
          resolveId(id) {
            if (shouldExternalizeNativeRuntime(id)) {
              return { external: true, id }
            }
            return null
          }
        },
        {
          name: 'assert-transcription-worker-isolation',
          generateBundle(_options, bundle) {
            const main = Object.values(bundle).find(
              (item) => item.type === 'chunk' && item.fileName === 'index.js'
            )
            if (!main) {
              throw new Error('main process bundle must emit index.js')
            }
            const mainCode = 'code' in main ? main.code : ''
            if (
              mainCode.includes('getElectronPath') ||
              mainCode.includes('npx install-electron') ||
              mainCode.includes('better_sqlite3.node')
            ) {
              throw new Error(
                'main process must not bundle electron or better-sqlite3; keep them on rollupOptions.external'
              )
            }
            const worker = Object.values(bundle).find(
              (item) =>
                item.type === 'chunk' &&
                (item.fileName === 'transcription-worker.js' ||
                  item.fileName === 'transcription-worker.mjs')
            )
            const code = worker && 'code' in worker ? worker.code : ''
            if (!code) {
              throw new Error('transcription-worker bundle is missing')
            }
            if (
              code.includes('require("./index.js")') ||
              code.includes('@electron-toolkit/utils')
            ) {
              throw new Error(
                'transcription-worker must not load Electron main; keep it on rollupOptions.input, not lib.entry'
              )
            }
          }
        }
      ],
      resolve: {
        alias: {
          '@main': resolve(import.meta.dirname, 'src/main'),
          '@shared': resolve(import.meta.dirname, 'src/shared')
        }
      },
      assetsInclude: ['**/*.png', '**/*.ico', '**/*.icns'],
      publicDir: false
    },
    preload: {
      define,
      build: {
        sourcemap: true,
        externalizeDeps: {
          exclude: bundledWorkspacePackages
        }
      }
    },
    renderer: {
      server: portlessUrl
        ? { host: '127.0.0.1', port: Number(process.env.PORT), strictPort: true }
        : undefined,
      base: './',
      define,
      build: {
        sourcemap: true
      },
      legacy: {
        inconsistentCjsInterop: true
      },
      optimizeDeps: {
        exclude: [
          '@vidbee/downloader-core',
          '@vidbee/downloader-core/browser-cookies-setting',
          '@vidbee/downloader-core/cookie-setup',
          '@vidbee/downloader-core/filename-style',
          '@vidbee/downloader-core/format-preferences',
          // mermaid.core.mjs pulls CJS named exports (`sanitizeUrl`) that Vite 8
          // serves raw. Alias mermaid to the bundled ESM build instead of
          // prebundling mermaid (Rolldown then loses chunk metadata).
          'mermaid',
          '@streamdown/mermaid',
          'katex'
        ],
        include: [
          'react',
          'react-dom',
          'react/jsx-runtime',
          '@videojs/react',
          'streamdown',
          '@streamdown/code',
          '@streamdown/math',
          '@streamdown/cjk',
          '@shadcn/react/message-scroller',
          // CJS UMD; Vite 8 otherwise serves it as ESM without a default export.
          'beautiful-mermaid',
          'elkjs/lib/elk.bundled.js'
        ]
      },
      resolve: {
        ...rendererResolve,
        alias: {
          ...rendererResolve.alias,
          mermaid: mermaidBundledEntry,
          'elkjs/lib/elk.bundled.js': elkBundledEntry
        }
      },
      plugins: [
        {
          name: 'dev-csp-inline-scripts',
          transformIndexHtml(html) {
            if (mode !== 'development') {
              return html
            }
            return html.replace(
              "script-src 'self' 'unsafe-eval'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
            )
          }
        },
        react(),
        Icons({
          compiler: 'jsx',
          customCollections: {
            lobehub: FileSystemIconLoader(lobeIconsDir)
          },
          jsx: 'react'
        }),
        tailwindcss()
      ]
    }
  }
})
