import path from 'node:path'

interface ResolveStartupDownloadPathOptions {
  currentPath?: string
  defaultPath: string
  oldDefaultPath: string
  portableMode: boolean
  portableRoot: string
  previousPortableRoot: string
}

/** Return whether a path is inside a root, including the root itself. */
const isPathInsideOrEqual = (candidate: string, root: string): boolean => {
  if (!(candidate && root)) {
    return false
  }

  const relativePath = path.relative(path.resolve(root), path.resolve(candidate))
  return (
    relativePath === '' ||
    (!!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  )
}

/**
 * Resolve the persisted download directory on startup while preserving an
 * explicit external path selected by a portable-mode user.
 */
export const resolveStartupDownloadPath = ({
  currentPath,
  defaultPath,
  oldDefaultPath,
  portableMode,
  portableRoot,
  previousPortableRoot
}: ResolveStartupDownloadPathOptions): string => {
  if (!currentPath || currentPath === oldDefaultPath) {
    return defaultPath
  }

  if (!(portableMode && previousPortableRoot)) {
    return currentPath
  }

  if (!isPathInsideOrEqual(currentPath, previousPortableRoot)) {
    return currentPath
  }

  return path.join(portableRoot, path.relative(previousPortableRoot, currentPath))
}
