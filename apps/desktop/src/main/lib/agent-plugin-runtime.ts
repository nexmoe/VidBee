import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { SessionEntry } from './agent-session-types'

/** Load legacy plugins with host utilities, without loading or installing the Coding Agent runtime. */
export async function createAgentPluginRuntime(packageRoot: string, directory: string) {
  const require = createRequire(join(packageRoot, 'package.json'))
  const { createJiti } = require('jiti') as typeof import('jiti')
  return createJiti(join(packageRoot, 'package.json'), {
    moduleCache: false,
    // Native loading bypasses aliases and would silently import the retired runtime.
    tryNative: false,
    nativeModules: ['@earendil-works/pi-ai', '@earendil-works/pi-tui'],
    transformModules: [
      '@gotgenes/pi-permission-system',
      '@mzwing/pi-permission-auto-review',
      'pi-web-access'
    ],
    virtualModules: {
      '@earendil-works/pi-coding-agent': {
        /** Bind configuration to this plugin instance, without changing process environment. */
        getAgentDir: () => directory,
        /** The only infrastructure root owned by the embedded host is its profile directory. */
        getPackageDir: () => directory,
        /** Terminal configuration commands are not exposed by the application host. */
        getSettingsListTheme: () => ({}),
        /** Support the web plugin's optional history inspection without another session runtime. */
        buildSessionContext: (entries: SessionEntry[]) => ({
          messages: entries.flatMap((entry) => (entry.type === 'message' ? [entry.message] : []))
        })
      }
    }
  })
}
