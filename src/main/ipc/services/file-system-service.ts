import { execFile, execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { clipboard, dialog, shell } from 'electron'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import { scopedLoggers } from '../../utils/logger'

const execFileAsync = promisify(execFile)

class FileSystemService extends IpcService {
  static readonly groupName = 'fs'

  @IpcMethod()
  async selectDirectory(_context: IpcContext): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  }

  @IpcMethod()
  async selectFile(_context: IpcContext): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  }

  @IpcMethod()
  getDefaultDownloadPath(_context: IpcContext): string {
    const fallbackPath = path.join(os.homedir(), 'Downloads')

    if (process.platform === 'linux' || process.platform === 'freebsd') {
      try {
        const xdgPath = execSync('xdg-user-dir DOWNLOAD', { encoding: 'utf8' }).trim()
        if (xdgPath) {
          return xdgPath
        }
      } catch (error) {
        scopedLoggers.system.warn(
          'Unable to resolve XDG download directory, falling back to default:',
          error
        )
      }
    }

    return fallbackPath
  }

  @IpcMethod()
  async openFileLocation(_context: IpcContext, filePath: string): Promise<boolean> {
    try {
      if (!filePath) {
        return false
      }

      const sanitizedPath = this.sanitizePath(filePath)
      const normalizedPath = path.normalize(sanitizedPath)
      const stats = await fs.stat(normalizedPath).catch(() => null)

      if (stats?.isFile()) {
        shell.showItemInFolder(normalizedPath)
        return true
      }

      if (stats?.isDirectory()) {
        const result = await shell.openPath(normalizedPath)
        if (result) {
          scopedLoggers.system.error('Failed to open directory:', result)
          return false
        }
        return true
      }

      // If the exact path doesn't exist, try to open the parent directory
      const parentDirectory = path.dirname(normalizedPath)
      const parentStats = await fs.stat(parentDirectory).catch(() => null)

      if (parentStats?.isDirectory()) {
        const result = await shell.openPath(parentDirectory)
        if (result) {
          scopedLoggers.system.error('Failed to open parent directory:', result)
          return false
        }
        return true
      }

      scopedLoggers.system.error('File or directory does not exist:', normalizedPath)
      return false
    } catch (error) {
      scopedLoggers.system.error('Failed to open file location:', error)
      return false
    }
  }

  @IpcMethod()
  async copyFileToClipboard(_context: IpcContext, filePath: string): Promise<boolean> {
    try {
      if (!filePath) {
        return false
      }

      const sanitizedPath = this.sanitizePath(filePath)
      const normalizedPath = path.normalize(sanitizedPath)
      const stats = await fs.stat(normalizedPath)
      if (!stats.isFile()) {
        return false
      }

      const resolvedPath = path.resolve(normalizedPath)

      await this.copyFileToClipboardByPlatform(resolvedPath)

      return true
    } catch (error) {
      scopedLoggers.system.error('Failed to copy file to clipboard:', error)
      return false
    }
  }

  private sanitizePath(target: string): string {
    return target.trim().replace(/^['"]|['"]$/g, '')
  }

  private async copyFileToClipboardByPlatform(resolvedPath: string): Promise<void> {
    switch (process.platform) {
      case 'win32':
        await this.copyFileToClipboardWindows(resolvedPath)
        return
      case 'darwin':
        await this.copyFileToClipboardMac(resolvedPath)
        return
      default:
        await this.copyFileToClipboardLinux(resolvedPath)
    }
  }

  @IpcMethod()
  async openExternal(_context: IpcContext, url: string): Promise<boolean> {
    try {
      await shell.openExternal(url)
      return true
    } catch (error) {
      scopedLoggers.system.error('Failed to open external URL:', error)
      return false
    }
  }

  private async copyFileToClipboardWindows(resolvedPath: string): Promise<void> {
    const escaped = resolvedPath.replace(/'/g, "''")
    try {
      await execFileAsync('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        `Set-Clipboard -Path '${escaped}'`
      ])
      return
    } catch (error) {
      scopedLoggers.system.error(
        'PowerShell clipboard copy failed, falling back to manual buffer:',
        error
      )
    }

    const winPath = resolvedPath.replace(/\//g, '\\')
    const fileList = `${winPath}\u0000\u0000`
    const encodedList = Buffer.from(fileList, 'ucs2')

    const dropFilesStructSize = 20
    const buffer = Buffer.alloc(dropFilesStructSize + encodedList.length)
    buffer.writeUInt32LE(dropFilesStructSize, 0)
    buffer.writeInt32LE(0, 4)
    buffer.writeInt32LE(0, 8)
    buffer.writeUInt32LE(0, 12)
    buffer.writeUInt32LE(1, 16)
    encodedList.copy(buffer, dropFilesStructSize)

    clipboard.writeBuffer('CF_HDROP', buffer)
    clipboard.writeBuffer('Preferred DropEffect', Buffer.from([1, 0, 0, 0]))
    clipboard.writeBuffer('FileNameW', Buffer.from(`${path.basename(resolvedPath)}\u0000`, 'ucs2'))
    clipboard.writeBuffer('FileName', Buffer.from(`${path.basename(resolvedPath)}\u0000`, 'ascii'))
  }

  private async copyFileToClipboardMac(resolvedPath: string): Promise<void> {
    const escaped = resolvedPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    try {
      await execFileAsync('osascript', ['-e', `set the clipboard to (POSIX file "${escaped}")`])
      return
    } catch (error) {
      scopedLoggers.system.error(
        'osascript clipboard copy failed, falling back to manual buffer:',
        error
      )
    }

    const entries = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<array>',
      `  <string>${this.escapeForPlist(resolvedPath)}</string>`,
      '</array>',
      '</plist>'
    ]
    const plist = Buffer.from(entries.join('\n'), 'utf8')
    clipboard.writeBuffer('NSFilenamesPboardType', plist)

    const fileUrl = pathToFileURL(resolvedPath).toString()
    clipboard.writeBuffer('public.file-url', Buffer.from(`${fileUrl}\n`, 'utf8'))
  }

  private async copyFileToClipboardLinux(resolvedPath: string): Promise<void> {
    const fileUrl = pathToFileURL(resolvedPath).toString()
    const content = `copy\n${fileUrl}`
    clipboard.writeBuffer('x-special/gnome-copied-files', Buffer.from(content, 'utf8'))
    clipboard.writeBuffer('text/uri-list', Buffer.from(`${fileUrl}\n`, 'utf8'))
  }

  private escapeForPlist(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  @IpcMethod()
  async fileExists(_context: IpcContext, filePath: string): Promise<boolean> {
    try {
      if (!filePath) {
        return false
      }

      const sanitizedPath = this.sanitizePath(filePath)
      const normalizedPath = path.normalize(sanitizedPath)

      const stats = await fs.stat(normalizedPath).catch(() => null)

      return stats?.isFile() ?? false
    } catch (error) {
      scopedLoggers.system.error('Failed to check file existence:', error)
      return false
    }
  }

  @IpcMethod()
  async deleteFile(_context: IpcContext, filePath: string): Promise<boolean> {
    try {
      if (!filePath) {
        return false
      }

      const sanitizedPath = this.sanitizePath(filePath)
      const normalizedPath = path.normalize(sanitizedPath)

      const stats = await fs.stat(normalizedPath).catch((error) => {
        const err = error as NodeJS.ErrnoException
        if (err?.code === 'ENOENT') {
          return null
        }
        throw error
      })

      if (!stats) {
        return false
      }

      if (stats.isFile()) {
        await fs.unlink(normalizedPath).catch((error) => {
          const err = error as NodeJS.ErrnoException
          if (err?.code !== 'ENOENT') {
            throw error
          }
        })
        return true
      }

      if (stats.isDirectory()) {
        const entries = await fs.readdir(normalizedPath)
        if (entries.length === 0) {
          await fs.rmdir(normalizedPath).catch((error) => {
            const err = error as NodeJS.ErrnoException
            if (err?.code !== 'ENOENT') {
              throw error
            }
          })
          return true
        }
      }

      return false
    } catch (error) {
      scopedLoggers.system.error('Failed to delete file:', error)
      return false
    }
  }
}

export { FileSystemService }
