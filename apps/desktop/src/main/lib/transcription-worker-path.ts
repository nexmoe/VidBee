import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Resolve a native worker bundle from either the main entry or a shared chunk. */
export const resolveWorkerBundle = (moduleDir: string, name = 'transcription-worker'): string => {
  const candidates = [join(moduleDir, `${name}.js`), join(moduleDir, `../${name}.js`)]
  const worker = candidates.find((path) => existsSync(path))
  if (!worker) {
    throw new Error(`${name} bundle not found in ${moduleDir}; rebuild the desktop app`)
  }
  return worker
}
