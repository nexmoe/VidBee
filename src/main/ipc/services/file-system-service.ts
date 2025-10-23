import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { dialog, shell } from 'electron'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'

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
    return `${os.homedir()}/Downloads`
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
        const candidate = await this.findLikelyFile(normalizedPath, normalizedPath)
        if (candidate) {
          shell.showItemInFolder(candidate)
          return true
        }

        const result = await shell.openPath(normalizedPath)
        if (result) {
          console.error('Failed to open directory:', result)
          return false
        }
        return true
      }

      const fallbackDirectory = path.dirname(normalizedPath)
      const fallbackCandidate = await this.findLikelyFile(fallbackDirectory, normalizedPath)
      if (fallbackCandidate) {
        shell.showItemInFolder(fallbackCandidate)
        return true
      }

      const result = await shell.openPath(fallbackDirectory)
      if (!result) {
        return true
      }
      console.error('Failed to open directory:', result)
    } catch (error) {
      try {
        const directory = path.dirname(path.normalize(this.sanitizePath(filePath)))
        const dirStats = await fs.stat(directory)
        if (dirStats.isDirectory()) {
          const fallbackCandidate = await this.findLikelyFile(directory, directory)
          if (fallbackCandidate) {
            shell.showItemInFolder(fallbackCandidate)
            return true
          }
          const result = await shell.openPath(directory)
          if (result) {
            console.error('Failed to open directory:', result)
            return false
          }
          return true
        }
      } catch (dirError) {
        console.error('Failed to open parent directory:', dirError)
      }
      console.error('Failed to open file location:', error)
      return false
    }

    return false
  }

  private sanitizePath(target: string): string {
    return target.trim().replace(/^['"]|['"]$/g, '')
  }

  private async findLikelyFile(directory: string, expectedPath: string): Promise<string | null> {
    try {
      const dirStats = await fs.stat(directory)
      if (!dirStats.isDirectory()) {
        return null
      }

      const entries = await fs.readdir(directory, { withFileTypes: true })
      const files = entries.filter((entry: Dirent) => entry.isFile())
      if (files.length === 0) {
        return null
      }

      const expectedBase = path.basename(expectedPath).toLowerCase()
      const expectedName = path.parse(expectedPath).name.toLowerCase()

      const exactMatch = files.find((entry) => entry.name.toLowerCase() === expectedBase)
      if (exactMatch) {
        return path.join(directory, exactMatch.name)
      }

      if (expectedName) {
        const partialMatch = files.find((entry) => entry.name.toLowerCase().includes(expectedName))
        if (partialMatch) {
          return path.join(directory, partialMatch.name)
        }
      }

      let latestMatch: { filePath: string; mtimeMs: number } | null = null
      for (const entry of files) {
        const candidatePath = path.join(directory, entry.name)
        try {
          const candidateStats = await fs.stat(candidatePath)
          if (!latestMatch || candidateStats.mtimeMs > latestMatch.mtimeMs) {
            latestMatch = { filePath: candidatePath, mtimeMs: candidateStats.mtimeMs }
          }
        } catch (statError) {
          console.error('Failed to stat candidate file:', statError)
        }
      }

      return latestMatch?.filePath ?? null
    } catch (error) {
      console.error('Failed to search for matching file:', error)
      return null
    }
  }

  @IpcMethod()
  async openExternal(_context: IpcContext, url: string): Promise<boolean> {
    try {
      await shell.openExternal(url)
      return true
    } catch (error) {
      console.error('Failed to open external URL:', error)
      return false
    }
  }
}

export { FileSystemService }
