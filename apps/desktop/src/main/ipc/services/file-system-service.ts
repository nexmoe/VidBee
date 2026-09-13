import { execFile, execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { embedArtifactImages } from '@shared/agent-markdown'
import type { ShareCardPayload } from '@shared/types/share-card'
import { BrowserWindow, clipboard, dialog, Notification, ShareMenu, shell } from 'electron'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import { getAgentChatStore } from '../../lib/agent-chat-store'
import { readAgentArtifactImage } from '../../lib/agent-media'
import { mediaFileDialogFilters } from '../../lib/import-local-media'
import {
  markdownToPrintableHtml,
  printHtmlToPdf,
  withVidBeeExportFooter
} from '../../lib/markdown-pdf'
import { captureShareCardPages } from '../../lib/share-capture-window'
import { saveSplitShareImageFiles } from '../../lib/share-image-split'
import { getPortableDownloadsPath, isPortableMode } from '../../portable'
import { scopedLoggers } from '../../utils/logger'

const execFileAsync = promisify(execFile)

/**
 * Inline cited screenshots as data URIs so exported Markdown/PDF files stay self-contained.
 *
 * @param markdown Reply body that may still use `artifact:` ids.
 * @param threadId Conversation that owns those attachments.
 */
async function markdownWithEmbeddedImages(markdown: string, threadId?: string): Promise<string> {
  if (!threadId) {
    return markdown
  }
  const artifacts = getAgentChatStore().get(threadId)?.artifacts
  if (!artifacts?.length) {
    return markdown
  }
  return await embedArtifactImages(markdown, artifacts, readAgentArtifactImage)
}

class FileSystemService extends IpcService {
  static readonly groupName = 'fs'

  /**
   * Read file paths currently on the system clipboard (Finder / Explorer copy).
   */
  @IpcMethod()
  readClipboardFilePaths(_context: IpcContext): string[] {
    try {
      if (process.platform === 'darwin') {
        const raw = clipboard.read('public.file-url')
        if (!raw.trim()) {
          return []
        }
        return raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            if (!line.toLowerCase().startsWith('file:')) {
              return line
            }
            try {
              return fileURLToPath(line)
            } catch {
              return line
            }
          })
      }
    } catch {
      return []
    }
    return []
  }

  @IpcMethod()
  async selectDirectory(_context: IpcContext): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
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

  /**
   * Open a multi-select dialog filtered to local audio and video files.
   */
  @IpcMethod()
  async selectMediaFiles(_context: IpcContext): Promise<string[]> {
    const options = {
      filters: mediaFileDialogFilters(),
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>
    }
    const window = BrowserWindow.getFocusedWindow()
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) {
      return []
    }

    return result.filePaths
  }

  /**
   * Ask the user where to save a UTF-8 text file and write it.
   */
  @IpcMethod()
  async saveTextFile(
    _context: IpcContext,
    options: { content: string; defaultFileName: string; threadId?: string }
  ): Promise<{ path: string } | null> {
    const fileName = path.basename(options.defaultFileName || 'transcript.txt')
    const defaultPath = path.join(this.getDefaultDownloadPath(_context), fileName)
    const extension = path.extname(fileName).replace('.', '') || 'txt'
    const filterName = extension === 'md' ? 'Markdown' : 'Text'
    const saveOptions = {
      defaultPath,
      filters: [{ extensions: [extension], name: filterName }]
    }
    const window = BrowserWindow.getFocusedWindow()
    const result = window
      ? await dialog.showSaveDialog(window, saveOptions)
      : await dialog.showSaveDialog(saveOptions)

    if (result.canceled || !result.filePath) {
      return null
    }

    const normalizedPath = path.normalize(this.sanitizePath(result.filePath))
    let content = await markdownWithEmbeddedImages(options.content, options.threadId)
    if (options.threadId) {
      content = withVidBeeExportFooter(content)
    }
    await fs.writeFile(normalizedPath, content, 'utf8')
    return { path: normalizedPath }
  }

  /**
   * Ask the user where to save a PDF, render markdown in a hidden window, and write it.
   *
   * @param _context IPC call context.
   * @param options Markdown body and the suggested download name.
   */
  @IpcMethod()
  async saveMarkdownPdf(
    _context: IpcContext,
    options: { markdown: string; defaultFileName: string; title?: string; threadId?: string }
  ): Promise<{ path: string } | null> {
    let fileName = path.basename(options.defaultFileName || 'VidBee.pdf')
    if (!fileName.toLowerCase().endsWith('.pdf')) {
      fileName = `${fileName}.pdf`
    }
    const defaultPath = path.join(this.getDefaultDownloadPath(_context), fileName)
    const saveOptions = {
      defaultPath,
      filters: [{ extensions: ['pdf'], name: 'PDF' }]
    }
    const window = BrowserWindow.getFocusedWindow()
    const result = window
      ? await dialog.showSaveDialog(window, saveOptions)
      : await dialog.showSaveDialog(saveOptions)

    if (result.canceled || !result.filePath) {
      return null
    }

    const normalizedPath = path.normalize(this.sanitizePath(result.filePath))
    const markdown = await markdownWithEmbeddedImages(options.markdown, options.threadId)
    const html = markdownToPrintableHtml(markdown, options.title)
    const tempPath = path.join(os.tmpdir(), `vidbee-export-${process.pid}-${Date.now()}.html`)
    try {
      await fs.writeFile(tempPath, html, 'utf8')
      const pdf = await printHtmlToPdf(
        tempPath,
        () =>
          new BrowserWindow({
            backgroundColor: '#ffffff',
            show: false,
            webPreferences: { sandbox: true }
          })
      )
      await fs.writeFile(normalizedPath, pdf)
      return { path: normalizedPath }
    } finally {
      await fs.unlink(tempPath).catch(() => {})
    }
  }

  /**
   * Ask the user where to save a PNG (or other binary) and write it.
   *
   * @param _context IPC call context.
   * @param options File bytes and the suggested download name.
   */
  @IpcMethod()
  async saveBinaryFile(
    _context: IpcContext,
    options: { data: ArrayBuffer; defaultFileName: string }
  ): Promise<{ path: string } | null> {
    let fileName = path.basename(options.defaultFileName || 'VidBee.png')
    if (!fileName.toLowerCase().endsWith('.png')) {
      fileName = `${fileName}.png`
    }
    const defaultPath = path.join(this.getDefaultDownloadPath(_context), fileName)
    const saveOptions = {
      defaultPath,
      filters: [{ extensions: ['png'], name: 'PNG' }]
    }
    const window = BrowserWindow.getFocusedWindow()
    const result = window
      ? await dialog.showSaveDialog(window, saveOptions)
      : await dialog.showSaveDialog(saveOptions)

    if (result.canceled || !result.filePath) {
      return null
    }

    const normalizedPath = path.normalize(this.sanitizePath(result.filePath))
    await fs.writeFile(normalizedPath, Buffer.from(new Uint8Array(options.data)))
    return { path: normalizedPath }
  }

  /** Choose one destination and save all numbered share-image parts in a new folder. */
  @IpcMethod()
  async saveSplitShareImage(
    _context: IpcContext,
    options: { payload: ShareCardPayload; defaultFileName: string; imageCount?: number }
  ): Promise<{ path: string; count: number } | null> {
    const directory = await this.selectDirectory(_context)
    if (!directory) {
      return null
    }
    const images = await captureShareCardPages(options.payload, options.imageCount)
    return await saveSplitShareImageFiles(directory, {
      images,
      defaultFileName: options.defaultFileName
    })
  }

  /**
   * Write a temp PNG and open the macOS share sheet.
   *
   * @param _context IPC call context.
   * @param options File bytes and the suggested share name.
   */
  @IpcMethod()
  async shareFile(
    _context: IpcContext,
    options: { data: ArrayBuffer; fileName: string }
  ): Promise<boolean> {
    if (process.platform !== 'darwin') {
      return false
    }

    const fileName = path.basename(options.fileName || 'VidBee.png').replace(/[<>:"/\\|?*]+/g, '_')
    const tempPath = path.join(os.tmpdir(), `vidbee-share-${process.pid}-${Date.now()}-${fileName}`)

    try {
      await fs.writeFile(tempPath, Buffer.from(new Uint8Array(options.data)))
      const window = BrowserWindow.getFocusedWindow()
      return await new Promise<boolean>((resolve) => {
        try {
          const shareMenu = new ShareMenu({ filePaths: [tempPath] })
          shareMenu.popup({
            ...(window ? { window } : {}),
            callback: () => resolve(true)
          })
        } catch (error) {
          scopedLoggers.system.error('Failed to open share sheet:', error)
          resolve(false)
        }
      })
    } catch (error) {
      scopedLoggers.system.error('Failed to prepare share file:', error)
      return false
    }
  }

  /**
   * Validate that the user-picked cookies file is a Netscape-format text file.
   *
   * GitHub issue #348: users picked Chrome's binary `Cookies` SQLite database
   * instead of an exported `cookies.txt`, which only surfaced as an opaque
   * `'utf-8' codec can't decode byte` error during a download. We sniff the
   * first chunk of the file so we can refuse the wrong format up front.
   */
  @IpcMethod()
  async validateCookiesFile(
    _context: IpcContext,
    filePath: string
  ): Promise<{ valid: boolean; reason?: 'not-found' | 'sqlite' | 'binary' | 'not-netscape' }> {
    if (!filePath) {
      return { valid: false, reason: 'not-found' }
    }

    const sanitizedPath = this.sanitizePath(filePath)
    const normalizedPath = path.normalize(sanitizedPath)

    let handle: fs.FileHandle | null = null
    try {
      handle = await fs.open(normalizedPath, 'r')
      const buffer = Buffer.alloc(1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const sample = buffer.subarray(0, bytesRead)

      if (sample.length >= 16 && sample.subarray(0, 15).toString('ascii') === 'SQLite format 3') {
        return { valid: false, reason: 'sqlite' }
      }

      if (sample.includes(0)) {
        return { valid: false, reason: 'binary' }
      }

      const text = sample.toString('utf8')
      const looksNetscape =
        text.includes('# Netscape HTTP Cookie File') ||
        text.includes('# HTTP Cookie File') ||
        /^[#\s]/.test(text) ||
        /\t(TRUE|FALSE)\t/i.test(text)
      if (!looksNetscape) {
        return { valid: false, reason: 'not-netscape' }
      }

      return { valid: true }
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err?.code === 'ENOENT') {
        return { valid: false, reason: 'not-found' }
      }
      scopedLoggers.system.error('Failed to validate cookies file:', error)
      return { valid: false, reason: 'binary' }
    } finally {
      await handle?.close().catch(() => {})
    }
  }

  @IpcMethod()
  getDefaultDownloadPath(_context: IpcContext): string {
    if (isPortableMode) {
      return getPortableDownloadsPath()
    }

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
  async openFile(_context: IpcContext, filePath: string): Promise<boolean> {
    try {
      if (!filePath) {
        return false
      }

      const sanitizedPath = this.sanitizePath(filePath)
      const normalizedPath = path.normalize(sanitizedPath)
      const stats = await fs.stat(normalizedPath).catch(() => null)

      if (!(stats && (stats.isFile() || stats.isDirectory()))) {
        scopedLoggers.system.error('File does not exist:', normalizedPath)
        return false
      }

      const result = await shell.openPath(normalizedPath)
      if (result) {
        scopedLoggers.system.error('Failed to open file:', result)
        return false
      }

      return true
    } catch (error) {
      scopedLoggers.system.error('Failed to open file:', error)
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

  /**
   * Open macOS System Settings to Privacy → Files & Folders.
   */
  @IpcMethod()
  async openMacFilesAndFoldersSettings(_context: IpcContext): Promise<boolean> {
    if (process.platform !== 'darwin') {
      return false
    }
    const urls = [
      'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
      'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_FilesAndFolders'
    ]
    for (const url of urls) {
      try {
        await shell.openExternal(url)
        return true
      } catch {}
    }
    scopedLoggers.system.error('Failed to open Files & Folders settings')
    return false
  }

  /**
   * Show a system notification for a completed download and open the result on click for issue #118.
   */
  @IpcMethod()
  showDownloadCompletedNotification(
    _context: IpcContext,
    title: string,
    body: string,
    filePaths: string[],
    downloadPath: string
  ): boolean {
    if (!Notification.isSupported()) {
      return false
    }

    const notification = new Notification({
      title,
      body,
      silent: false
    })

    notification.on('click', () => {
      void this.openNotificationTarget(filePaths, downloadPath)
    })

    notification.show()
    return true
  }

  /**
   * Open the saved file when it exists, otherwise open the download directory.
   */
  private async openNotificationTarget(filePaths: string[], downloadPath: string): Promise<void> {
    for (const filePath of filePaths) {
      const sanitizedPath = this.sanitizePath(filePath)
      const normalizedPath = path.normalize(sanitizedPath)
      const stats = await fs.stat(normalizedPath).catch(() => null)

      if (!stats?.isFile()) {
        continue
      }

      const result = await shell.openPath(normalizedPath)
      if (!result) {
        return
      }

      scopedLoggers.system.error('Failed to open notification file target:', result)
    }

    if (!downloadPath) {
      return
    }

    const normalizedDownloadPath = path.normalize(this.sanitizePath(downloadPath))
    const result = await shell.openPath(normalizedDownloadPath)
    if (result) {
      scopedLoggers.system.error('Failed to open notification download path:', result)
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
