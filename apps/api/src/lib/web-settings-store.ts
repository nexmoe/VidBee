import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { WebAppSettingsSchema } from '@vidbee/downloader-core'

const STORAGE_DIR = path.resolve(process.cwd(), '.data')
const STORAGE_FILE = path.join(STORAGE_DIR, 'web-settings.json')

const defaultWebSettings = WebAppSettingsSchema.parse({
  downloadPath: '',
  maxConcurrentDownloads: 5,
  browserForCookies: 'none',
  cookiesPath: '',
  proxy: '',
  configPath: '',
  betaProgram: false,
  language: 'en',
  theme: 'system',
  oneClickDownload: false,
  oneClickDownloadType: 'video',
  oneClickQuality: 'best',
  closeToTray: true,
  autoUpdate: true,
  subscriptionOnlyLatestDefault: true,
  enableAnalytics: true,
  embedSubs: true,
  embedThumbnail: false,
  embedMetadata: true,
  embedChapters: true,
  shareWatermark: false
})

type WebAppSettings = typeof defaultWebSettings

class WebSettingsStore {
  private settings = defaultWebSettings
  private initialized = false

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return
    }

    this.initialized = true

    try {
      const raw = await readFile(STORAGE_FILE, 'utf-8')
      const parsed = JSON.parse(raw)
      const result = WebAppSettingsSchema.safeParse(parsed)
      if (result.success) {
        this.settings = result.data
      }
    } catch {
      this.settings = defaultWebSettings
    }
  }

  async get(): Promise<WebAppSettings> {
    await this.ensureInitialized()
    return this.settings
  }

  async set(nextSettings: WebAppSettings): Promise<WebAppSettings> {
    await this.ensureInitialized()
    const validated = WebAppSettingsSchema.parse(nextSettings)
    await mkdir(STORAGE_DIR, { recursive: true })
    await writeFile(STORAGE_FILE, JSON.stringify(validated), 'utf-8')
    this.settings = validated
    return this.settings
  }
}

export const webSettingsStore = new WebSettingsStore()
