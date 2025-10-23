import fs from 'node:fs/promises'
import path from 'node:path'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { DownloadHistoryItem } from '../../../shared/types'
import { historyManager } from '../../lib/history-manager'
import { settingsManager } from '../../settings'

class HistoryService extends IpcService {
  static readonly groupName = 'history'

  @IpcMethod()
  getHistory(_context: IpcContext): DownloadHistoryItem[] {
    return historyManager.getHistory()
  }

  @IpcMethod()
  getHistoryById(_context: IpcContext, id: string): DownloadHistoryItem | undefined {
    return historyManager.getHistoryById(id)
  }

  @IpcMethod()
  addHistoryItem(_context: IpcContext, item: DownloadHistoryItem): void {
    historyManager.addHistoryItem(item)
  }

  @IpcMethod()
  async removeHistoryItem(_context: IpcContext, id: string, outputPath?: string): Promise<boolean> {
    const record = historyManager.getHistoryById(id)

    await this.deleteOutputResource(record, outputPath)

    return historyManager.removeHistoryItem(id)
  }

  private async deleteOutputResource(
    record: DownloadHistoryItem | undefined,
    fallbackOutputPath?: string
  ): Promise<void> {
    try {
      const candidatePaths = new Set<string>()
      if (record?.outputPath) {
        candidatePaths.add(record.outputPath)
      }
      if (fallbackOutputPath) {
        candidatePaths.add(fallbackOutputPath)
      }

      for (const candidate of candidatePaths) {
        if (await this.tryDeletePath(candidate)) {
          return
        }
      }

      const directories = this.collectCandidateDirectories(candidatePaths)
      if (directories.length === 0) {
        const defaultDownloadPath = settingsManager.get('downloadPath')
        if (defaultDownloadPath) {
          directories.push(defaultDownloadPath)
        }
      }

      const matchKeys = this.collectMatchKeys(record, candidatePaths)
      if (matchKeys.length === 0) {
        return
      }

      const extensions = this.collectExtensions(candidatePaths, record)
      for (const directory of directories) {
        const matchedPath = await this.findMatchingFile(directory, matchKeys, extensions, record)
        if (matchedPath && (await this.tryDeletePath(matchedPath))) {
          return
        }
      }
    } catch (error) {
      console.error('Failed to delete output resource:', error)
    }
  }

  private sanitizePath(target: string): string {
    return target.trim().replace(/^['"]|['"]$/g, '')
  }

  private normalizeMatchString(value?: string): string {
    if (!value) {
      return ''
    }
    return value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '')
  }

  private collectCandidateDirectories(candidatePaths: Set<string>): string[] {
    const directories = new Set<string>()
    for (const candidate of candidatePaths) {
      const sanitized = this.sanitizePath(candidate)
      if (!sanitized) continue
      const normalized = path.normalize(sanitized)
      if (!path.isAbsolute(normalized)) continue
      const directory = path.dirname(normalized)
      if (directory) {
        directories.add(directory)
      }
    }
    return Array.from(directories)
  }

  private collectExtensions(
    candidatePaths: Set<string>,
    record: DownloadHistoryItem | undefined
  ): Set<string> {
    const extensions = new Set<string>()

    const addExtension = (ext?: string) => {
      if (!ext) {
        return
      }
      const trimmed = ext.trim()
      if (!trimmed) {
        return
      }
      const normalized = trimmed.startsWith('.')
        ? trimmed.toLowerCase()
        : `.${trimmed.toLowerCase()}`
      extensions.add(normalized)
    }

    for (const candidate of candidatePaths) {
      const sanitized = this.sanitizePath(candidate)
      if (!sanitized) continue
      addExtension(path.extname(sanitized))
    }

    addExtension(record?.outputPath ? path.extname(record.outputPath) : undefined)
    addExtension(record?.selectedFormat?.ext)
    addExtension(record?.selectedFormat?.video_ext)
    addExtension(record?.selectedFormat?.audio_ext)

    if (extensions.size === 0) {
      const fallback =
        record?.type === 'audio'
          ? ['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.wav']
          : ['.mp4', '.mkv', '.webm', '.mov', '.avi']
      for (const ext of fallback) {
        extensions.add(ext)
      }
    }

    return extensions
  }

  private collectMatchKeys(
    record: DownloadHistoryItem | undefined,
    candidatePaths: Set<string>
  ): string[] {
    const keys = new Set<string>()
    const fallbackKeys: string[] = []

    const tryAddKey = (value?: string) => {
      if (!value) return
      const normalized = this.normalizeMatchString(value)
      if (!normalized) return
      if (normalized.length >= 3) {
        keys.add(normalized)
      } else {
        fallbackKeys.push(normalized)
      }
    }

    for (const candidate of candidatePaths) {
      const sanitized = this.sanitizePath(candidate)
      if (!sanitized) continue
      const baseName = path.parse(sanitized).name
      tryAddKey(baseName)
    }

    tryAddKey(record?.title)
    tryAddKey(record?.id)

    if (keys.size === 0) {
      for (const key of fallbackKeys) {
        keys.add(key)
      }
    }

    return Array.from(keys)
  }

  private async findMatchingFile(
    directory: string,
    matchKeys: string[],
    extensions: Set<string>,
    record: DownloadHistoryItem | undefined
  ): Promise<string | null> {
    try {
      const dirStats = await fs.stat(directory).catch((error) => {
        const err = error as NodeJS.ErrnoException
        if (err?.code === 'ENOENT') {
          return null
        }
        throw error
      })

      if (!dirStats || !dirStats.isDirectory()) {
        return null
      }

      const entries = await fs.readdir(directory, { withFileTypes: true })
      const matches: Array<{ path: string; diff: number }> = []
      const targetTimestamp = record?.completedAt ?? record?.downloadedAt
      const maxDiff = 10 * 60 * 1000 // 10 minutes

      for (const entry of entries) {
        if (!entry.isFile()) continue

        const entryPath = path.join(directory, entry.name)
        const entryExt = path.extname(entry.name).toLowerCase()
        if (extensions.size > 0 && entryExt && !extensions.has(entryExt)) {
          continue
        }

        const normalizedName = this.normalizeMatchString(entry.name)
        if (!normalizedName && matchKeys.length > 0) continue

        const hasMatchKeys = matchKeys.length > 0
        const isMatch = hasMatchKeys
          ? matchKeys.some((key) => key && normalizedName.includes(key))
          : true
        if (!isMatch) continue

        const stats = await fs.stat(entryPath).catch(() => null)
        if (!stats) continue

        if (targetTimestamp) {
          const diff = Math.abs(stats.mtimeMs - targetTimestamp)
          if (diff > maxDiff) {
            continue
          }
          matches.push({ path: entryPath, diff })
        } else {
          if (!hasMatchKeys) {
            continue
          }
          matches.push({ path: entryPath, diff: Number.POSITIVE_INFINITY })
        }
      }

      if (matches.length === 0) {
        return null
      }

      matches.sort((a, b) => a.diff - b.diff)
      return matches[0]?.path ?? null
    } catch (error) {
      console.error('Failed to search for matching file:', error)
      return null
    }
  }

  private async tryDeletePath(rawPath: string): Promise<boolean> {
    const sanitizedPath = this.sanitizePath(rawPath)
    if (!sanitizedPath) return false

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
  }

  @IpcMethod()
  getHistoryCount(_context: IpcContext): {
    active: number
    completed: number
    error: number
    cancelled: number
    total: number
  } {
    return historyManager.getHistoryCount()
  }
}

export { HistoryService }
