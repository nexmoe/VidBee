import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { implement, ORPCError } from '@orpc/server'
import { downloaderContract } from '@vidbee/downloader-core'
import { downloaderCore, historyStore } from './downloader'
import { webSettingsStore } from './web-settings-store'

const os = implement(downloaderContract)

const toErrorMessage = (error: unknown, fallbackMessage: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return fallbackMessage
}

const runProcess = (command: string, args: string[]): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'ignore',
      windowsHide: true
    })

    child.on('error', () => {
      resolve(false)
    })

    child.on('close', (code) => {
      resolve(code === 0)
    })
  })

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

const isPathWithinBase = (basePath: string, targetPath: string): boolean => {
  const normalizedBase = path.resolve(basePath)
  const normalizedTarget = path.resolve(targetPath)
  const relativePath = path.relative(normalizedBase, normalizedTarget)

  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

const openFileWithSystem = async (targetPath: string): Promise<boolean> => {
  if (process.platform === 'darwin') {
    return runProcess('open', [targetPath])
  }

  if (process.platform === 'win32') {
    return runProcess('cmd', ['/c', 'start', '', targetPath])
  }

  return runProcess('xdg-open', [targetPath])
}

const openFileLocationWithSystem = async (targetPath: string): Promise<boolean> => {
  if (process.platform === 'darwin') {
    return runProcess('open', ['-R', targetPath])
  }

  if (process.platform === 'win32') {
    return runProcess('explorer', [`/select,${targetPath}`])
  }

  return runProcess('xdg-open', [path.dirname(targetPath)])
}

const copyFileToClipboardWithSystem = async (targetPath: string): Promise<boolean> => {
  if (process.platform === 'darwin') {
    const escapedPath = targetPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return runProcess('osascript', ['-e', `set the clipboard to (POSIX file "${escapedPath}")`])
  }

  if (process.platform === 'win32') {
    const escapedPath = targetPath.replace(/'/g, "''")
    return runProcess('powershell', [
      '-NoProfile',
      '-Command',
      `Set-Clipboard -Path '${escapedPath}'`
    ])
  }

  return false
}

const listServerDirectories = async (
  rawPath: string | undefined
): Promise<{
  currentPath: string
  parentPath: string | null
  directories: { name: string; path: string }[]
}> => {
  const requestedPath = rawPath?.trim()
  const candidatePath = requestedPath && requestedPath.length > 0 ? requestedPath : process.cwd()
  const currentPath = path.resolve(candidatePath)

  const pathInfo = await stat(currentPath)
  if (!pathInfo.isDirectory()) {
    throw new Error('Path is not a directory.')
  }

  const entries = await readdir(currentPath, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(currentPath, entry.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const parsed = path.parse(currentPath)
  const parentPath = currentPath === parsed.root ? null : path.dirname(currentPath)

  return { currentPath, parentPath, directories }
}

export const rpcRouter = os.router({
  status: os.status.handler(() => {
    const status = downloaderCore.getStatus()
    return {
      ok: true,
      version: '1.0.0',
      active: status.active,
      pending: status.pending
    }
  }),
  videoInfo: os.videoInfo.handler(async ({ input }) => {
    try {
      const video = await downloaderCore.getVideoInfo(input.url, input.settings)
      return { video }
    } catch (error) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: toErrorMessage(error, 'Failed to fetch video info.')
      })
    }
  }),
  playlist: {
    info: os.playlist.info.handler(async ({ input }) => {
      try {
        const playlist = await downloaderCore.getPlaylistInfo(input.url, input.settings)
        return { playlist }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to fetch playlist info.')
        })
      }
    }),
    download: os.playlist.download.handler(async ({ input }) => {
      try {
        const result = await downloaderCore.startPlaylistDownload(input)
        return { result }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to start playlist download.')
        })
      }
    })
  },
  downloads: {
    create: os.downloads.create.handler(async ({ input }) => {
      try {
        const download = await downloaderCore.createDownload(input)
        return { download }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to create download.')
        })
      }
    }),
    list: os.downloads.list.handler(() => {
      return {
        downloads: downloaderCore.listDownloads()
      }
    }),
    cancel: os.downloads.cancel.handler(async ({ input }) => {
      try {
        const cancelled = await downloaderCore.cancelDownload(input.id)
        return { cancelled }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to cancel download.')
        })
      }
    })
  },
  history: {
    list: os.history.list.handler(() => {
      return {
        history: historyStore.list()
      }
    }),
    removeItems: os.history.removeItems.handler(({ input }) => {
      try {
        const removed = historyStore.removeItems(input.ids)
        downloaderCore.removeHistoryItems(input.ids)
        return { removed }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to remove history items.')
        })
      }
    }),
    removeByPlaylist: os.history.removeByPlaylist.handler(({ input }) => {
      try {
        const removed = historyStore.removeByPlaylist(input.playlistId)
        downloaderCore.removeHistoryByPlaylist(input.playlistId)
        return { removed }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to remove playlist history.')
        })
      }
    })
  },
  files: {
    exists: os.files.exists.handler(async ({ input }) => {
      try {
        const resolvedPath = path.resolve(input.path)
        return { exists: await pathExists(resolvedPath) }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to check file existence.')
        })
      }
    }),
    listDirectories: os.files.listDirectories.handler(async ({ input }) => {
      try {
        return await listServerDirectories(input.path)
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to list server directories.')
        })
      }
    }),
    openFile: os.files.openFile.handler(async ({ input }) => {
      try {
        const resolvedPath = path.resolve(input.path)
        const exists = await pathExists(resolvedPath)
        if (!exists) {
          return { success: false }
        }

        return { success: await openFileWithSystem(resolvedPath) }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to open file.')
        })
      }
    }),
    openFileLocation: os.files.openFileLocation.handler(async ({ input }) => {
      try {
        const resolvedPath = path.resolve(input.path)
        const exists = await pathExists(resolvedPath)
        if (!exists) {
          return { success: false }
        }

        return { success: await openFileLocationWithSystem(resolvedPath) }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to open file location.')
        })
      }
    }),
    copyFileToClipboard: os.files.copyFileToClipboard.handler(async ({ input }) => {
      try {
        const resolvedPath = path.resolve(input.path)
        const exists = await pathExists(resolvedPath)
        if (!exists) {
          return { success: false }
        }

        return { success: await copyFileToClipboardWithSystem(resolvedPath) }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to copy file to clipboard.')
        })
      }
    }),
    deleteFile: os.files.deleteFile.handler(async ({ input }) => {
      try {
        const settings = await webSettingsStore.get()
        const managedDownloadPath = settings.downloadPath.trim()
        if (!managedDownloadPath) {
          throw new ORPCError('FORBIDDEN', {
            message: 'Deleting files is disabled until a download path is configured.'
          })
        }

        const resolvedPath = path.resolve(input.path)
        if (!isPathWithinBase(managedDownloadPath, resolvedPath)) {
          throw new ORPCError('FORBIDDEN', {
            message: 'Refusing to delete files outside the managed download directory.'
          })
        }

        const exists = await pathExists(resolvedPath)
        if (!exists) {
          return { success: false }
        }

        await rm(resolvedPath)
        return { success: true }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to delete file.')
        })
      }
    })
  },
  settings: {
    get: os.settings.get.handler(async () => {
      try {
        const settings = await webSettingsStore.get()
        return { settings }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to read settings.')
        })
      }
    }),
    set: os.settings.set.handler(async ({ input }) => {
      try {
        const settings = await webSettingsStore.set(input.settings)
        return { settings }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to save settings.')
        })
      }
    })
  }
})
