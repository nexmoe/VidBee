import os from 'node:os'
import path from 'node:path'

export const resolvePathWithHome = (rawPath?: string | null): string | undefined => {
  const trimmed = rawPath?.trim()
  if (!trimmed) {
    return undefined
  }

  if (trimmed === '~') {
    return os.homedir()
  }

  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }

  return trimmed
}
