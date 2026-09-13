import crypto from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { APP_PROTOCOL_SCHEME } from '@shared/constants'
import { app } from 'electron'
import { scopedLoggers } from '../utils/logger'

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.ico'])
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff])
const ICO_MAGIC = Buffer.from([0x00, 0x00, 0x01, 0x00])
const GIF87A_MAGIC = Buffer.from('GIF87a')
const GIF89A_MAGIC = Buffer.from('GIF89a')

/**
 * Map a response Content-Type onto a cache file extension.
 * Favicon hosts often serve SVG or ICO rather than JPEG/PNG.
 */
const contentTypeToExtension = (contentType?: string): string | null => {
  if (!contentType) {
    return null
  }
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (type.includes('svg')) {
    return '.svg'
  }
  if (type.includes('icon') || type === 'image/ico') {
    return '.ico'
  }
  if (type.includes('jpeg')) {
    return '.jpg'
  }
  if (type.includes('png')) {
    return '.png'
  }
  if (type.includes('webp')) {
    return '.webp'
  }
  if (type.includes('gif')) {
    return '.gif'
  }
  return null
}

/**
 * Collapse `.jpeg` onto `.jpg` so sniffing and cache lookup agree.
 */
const normalizeExtension = (extension: string): string => {
  return extension === '.jpeg' ? '.jpg' : extension
}

/**
 * Sniff image bytes so SVG/ICO favicons are never persisted as JPEG.
 */
const extensionFromBuffer = (buffer: Buffer): string | null => {
  if (buffer.length >= PNG_MAGIC.length && buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return '.png'
  }
  if (
    buffer.length >= JPEG_MAGIC.length &&
    buffer.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)
  ) {
    return '.jpg'
  }
  if (
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).equals(GIF87A_MAGIC) || buffer.subarray(0, 6).equals(GIF89A_MAGIC))
  ) {
    return '.gif'
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return '.webp'
  }
  if (buffer.length >= ICO_MAGIC.length && buffer.subarray(0, ICO_MAGIC.length).equals(ICO_MAGIC)) {
    return '.ico'
  }
  const prefix = buffer
    .subarray(0, Math.min(buffer.length, 256))
    .toString('utf8')
    .trimStart()
    .toLowerCase()
  if (prefix.includes('<svg') || prefix.includes('<!doctype svg')) {
    return '.svg'
  }
  return null
}

/**
 * Prefer sniffed bytes, then Content-Type, then the URL extension.
 */
const resolveImageExtension = (
  buffer: Buffer,
  contentType: string | undefined,
  fallbackExtension: string
): string => {
  return (
    extensionFromBuffer(buffer) ??
    contentTypeToExtension(contentType) ??
    (SUPPORTED_EXTENSIONS.has(fallbackExtension) ? fallbackExtension : '.jpg')
  )
}

export class ThumbnailCache {
  private cacheDir?: string
  private readonly pending: Map<string, Promise<string | null>> = new Map()
  private readonly userDataOverride?: string

  constructor(userDataOverride?: string) {
    this.userDataOverride = userDataOverride
  }

  private userDataPath(): string {
    return this.userDataOverride ?? app.getPath('userData')
  }

  private ensureCacheDir(): string {
    if (this.cacheDir) {
      return this.cacheDir
    }
    const dir = path.join(this.userDataPath(), 'thumbnails')
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
      const contentType = response.headers.get('content-type') ?? undefined
      if (!(extensionFromBuffer(buffer) || contentTypeToExtension(contentType))) {
        throw new Error('Thumbnail response is not an image')
      }
      const extension = resolveImageExtension(buffer, contentType, defaultExtension)
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
    const extensions = new Set(SUPPORTED_EXTENSIONS)
    if (defaultExtension) {
      extensions.add(defaultExtension)
    }

    for (const ext of extensions) {
      const candidate = `${basePath}${ext}`
      if (!(await this.exists(candidate))) {
        continue
      }
      if (await this.isValidCachedImage(candidate, ext)) {
        return candidate
      }
      await this.removeInvalidCache(candidate)
    }

    return null
  }

  /**
   * True when the cached file's bytes match its extension.
   * Older caches stored SVG favicons as `.jpg`, which Chromium cannot paint.
   */
  private async isValidCachedImage(filePath: string, extension: string): Promise<boolean> {
    try {
      const buffer = await fsPromises.readFile(filePath)
      if (buffer.length === 0) {
        return false
      }
      const sniffed = extensionFromBuffer(buffer)
      if (!sniffed) {
        return true
      }
      return normalizeExtension(sniffed) === normalizeExtension(extension)
    } catch {
      return false
    }
  }

  private async removeInvalidCache(filePath: string): Promise<void> {
    try {
      await fsPromises.unlink(filePath)
    } catch {
      // Ignore missing or locked files; the next fetch will overwrite if needed.
    }
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
    const relativePath = path.relative(this.userDataPath(), filePath).replace(/\\/g, '/')

    return `${APP_PROTOCOL_SCHEME}${relativePath}`
  }
}

export const thumbnailCache = new ThumbnailCache()
