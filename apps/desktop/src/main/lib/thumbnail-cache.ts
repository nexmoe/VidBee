import crypto from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { APP_PROTOCOL_SCHEME } from '@shared/constants'
import { app } from 'electron'
import { scopedLoggers } from '../utils/logger'

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

const contentTypeToExtension = (contentType?: string): string => {
  if (!contentType) {
    return '.jpg'
  }
  if (contentType.includes('jpeg')) {
    return '.jpg'
  }
  if (contentType.includes('png')) {
    return '.png'
  }
  if (contentType.includes('webp')) {
    return '.webp'
  }
  if (contentType.includes('gif')) {
    return '.gif'
  }
  return '.jpg'
}

export class ThumbnailCache {
  private cacheDir?: string
  private readonly pending: Map<string, Promise<string | null>> = new Map()

  private ensureCacheDir(): string {
    if (this.cacheDir) {
      return this.cacheDir
    }
    const dir = path.join(app.getPath('userData'), 'thumbnails')
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    this.cacheDir = dir
    return dir
  }

  async getThumbnailUrl(originalUrl: string): Promise<string | null> {
    if (!originalUrl) {
      return null
    }

    if (
      originalUrl.startsWith(APP_PROTOCOL_SCHEME) ||
      originalUrl.startsWith('file://') ||
      originalUrl.startsWith('data:')
    ) {
      return originalUrl
    }

    if (this.pending.has(originalUrl)) {
      return this.pending.get(originalUrl) ?? null
    }

    const task = this.fetchAndCache(originalUrl).finally(() => {
      this.pending.delete(originalUrl)
    })
    this.pending.set(originalUrl, task)
    return task
  }

  private async fetchAndCache(originalUrl: string): Promise<string | null> {
    try {
      const cacheDir = this.ensureCacheDir()
      const { basePath, defaultExtension } = this.getBasePath(cacheDir, originalUrl)

      const existingPath = await this.findExistingPath(basePath, defaultExtension)
      if (existingPath) {
        return this.toAppProtocolUrl(existingPath)
      }

      const response = await fetch(originalUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch thumbnail (${response.status})`)
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const extension =
        contentTypeToExtension(response.headers.get('content-type') ?? undefined) ||
        defaultExtension
      const finalPath = `${basePath}${extension}`

      await fsPromises.writeFile(finalPath, buffer)
      return this.toAppProtocolUrl(finalPath)
    } catch (error) {
      scopedLoggers.thumbnail.error('Failed to cache thumbnail:', error)
      return null
    }
  }

  private async findExistingPath(
    basePath: string,
    defaultExtension: string
  ): Promise<string | null> {
    for (const ext of SUPPORTED_EXTENSIONS) {
      const candidate = `${basePath}${ext}`
      if (await this.exists(candidate)) {
        return candidate
      }
    }

    const fallback = `${basePath}${defaultExtension}`
    if (await this.exists(fallback)) {
      return fallback
    }

    return null
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fsPromises.access(filePath)
      return true
    } catch {
      return false
    }
  }

  private getBasePath(
    cacheDir: string,
    url: string
  ): {
    basePath: string
    defaultExtension: string
  } {
    const hash = crypto.createHash('sha1').update(url).digest('hex')
    let extension = '.jpg'
    try {
      const parsedUrl = new URL(url)
      const urlExt = path.extname(parsedUrl.pathname).toLowerCase()
      if (SUPPORTED_EXTENSIONS.has(urlExt)) {
        extension = urlExt
      }
    } catch {
      // Ignore parsing errors and keep default extension
    }

    const basePath = path.join(cacheDir, `${hash}`)
    return { basePath, defaultExtension: extension }
  }

  private toAppProtocolUrl(filePath: string): string {
    const userDataPath = app.getPath('userData')
    const relativePath = path.relative(userDataPath, filePath).replace(/\\/g, '/')

    return `${APP_PROTOCOL_SCHEME}${relativePath}`
  }
}

export const thumbnailCache = new ThumbnailCache()
