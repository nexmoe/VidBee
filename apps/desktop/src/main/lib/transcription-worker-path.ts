import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Resolve the worker bundle from either the main entry or a shared chunk. */
export const resolveWorkerBundle = (moduleDir: string): string => {
  const candidates = [
    join(moduleDir, 'transcription-worker.js'),
    join(moduleDir, '../transcription-worker.js')
  ]
  const worker = candidates.find((path) => existsSync(path))
  if (!worker) {
    throw new Error(
      `Transcription worker bundle not found in ${moduleDir}; rebuild the desktop app`
    )
  }
  return worker
}
