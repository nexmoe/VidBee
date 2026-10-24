import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Task } from '@vidbee/task-queue'

const fileOk = (path: string | null | undefined): path is string =>
  Boolean(path && existsSync(path) && statSync(path).size > 0)

/** Resolve playable media without treating a subtitle export as an audio/video source. */
export const resolveTaskSourceFile = (task: Readonly<Task>): string | null => {
  if (task.kind === 'subtitles') {
    return null
  }
  if (fileOk(task.output?.filePath)) {
    return task.output.filePath
  }
  const opts = (task.input.options ?? {}) as Record<string, unknown>
  const downloadPath = typeof opts.downloadPath === 'string' ? opts.downloadPath : null
  const custom = typeof opts.customDownloadPath === 'string' ? opts.customDownloadPath : null
  const saved = typeof opts.savedFileName === 'string' ? opts.savedFileName : null
  const dir = custom || downloadPath
  if (dir && saved) {
    const candidate = join(dir, saved)
    if (fileOk(candidate)) {
      return candidate
    }
  }
  return null
}
