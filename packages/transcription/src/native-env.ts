import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { resolveWorkerExecPath } from './runtime'

export { resolveWorkerExecPath }

const require = createRequire(import.meta.url)

/**
 * sherpa-onnx-node publishes `sherpa-onnx-win-*` instead of `win32`.
 */
export const sherpaNativePackageName = (
  platform = process.platform,
  arch = process.arch
): string => {
  const osName = platform === 'win32' ? 'win' : platform
  return `sherpa-onnx-${osName}-${arch}`
}

/**
 * Directory of the platform-specific sherpa-onnx shared libraries.
 * On macOS the worker must set DYLD_LIBRARY_PATH to this folder.
 * Only the matching platform/arch package is accepted so a cross-built
 * x64 app cannot pick up an arm64 leftover.
 */
export function resolveSherpaLibraryDir(): string | null {
  const id = sherpaNativePackageName()
  try {
    return dirname(require.resolve(`${id}/package.json`))
  } catch {
    /* try sibling of sherpa-onnx-node */
  }
  try {
    const nodeDir = dirname(require.resolve('sherpa-onnx-node/package.json'))
    const sibling = join(nodeDir, '..', id)
    if (existsSync(join(sibling, 'package.json'))) {
      return sibling
    }
  } catch {
    /* not installed */
  }
  return null
}

export function sherpaWorkerEnv(
  extra?: NodeJS.ProcessEnv,
  opts?: { electronAsNode?: boolean }
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extra
  }
  if (opts?.electronAsNode !== false) {
    env.ELECTRON_RUN_AS_NODE = '1'
  }
  const libDir = resolveSherpaLibraryDir()
  if (!libDir) {
    return env
  }
  if (process.platform === 'darwin') {
    env.DYLD_LIBRARY_PATH = [libDir, env.DYLD_LIBRARY_PATH].filter(Boolean).join(':')
  }
  if (process.platform === 'linux') {
    env.LD_LIBRARY_PATH = [libDir, env.LD_LIBRARY_PATH].filter(Boolean).join(':')
  }
  if (process.platform === 'win32') {
    env.PATH = [libDir, env.PATH].filter(Boolean).join(';')
  }
  return env
}
