import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { type DownloadRuntimeSettings, WebAppSettingsSchema } from '@vidbee/downloader-core'
import { DEFAULT_SUBTITLE_LANGUAGES } from '@vidbee/downloader-core/subtitle-languages'
import { apiDataDir, apiDefaultDownloadDir, apiSettingsFile } from './api-paths'

const defaultWebSettings = WebAppSettingsSchema.parse({
  downloadPath: apiDefaultDownloadDir,
  maxConcurrentDownloads: 5,
  browserForCookies: 'none',
  cookiesPath: '',
  proxy: '',
  configPath: '',
  language: 'en',
  theme: 'system',
  oneClickDownload: false,
  oneClickDownloadType: 'video',
  oneClickQuality: 'best',
  oneClickContainer: 'auto',
  closeToTray: true,
  autoUpdate: true,
  subscriptionOnlyLatestDefault: true,
  enableAnalytics: true,
  downloadSubtitles: true,
  subtitleLanguages: [...DEFAULT_SUBTITLE_LANGUAGES],
  embedSubs: true,
  writeAutoSubs: true,
  embedThumbnail: false,
  embedMetadata: true,
  embedChapters: true,
  filenameStyle: 'pretty',
  filenameViaVidBee: true,
  shareWatermark: false,
  autoTranscribeAfterDownload: true,
  maxConcurrentTranscriptions: 1,
  asrTier: 'minimal'
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
      const raw = await readFile(apiSettingsFile, 'utf-8')
      const parsed = JSON.parse(raw)
      const result = WebAppSettingsSchema.safeParse(parsed)
      if (result.success) {
        this.settings = result.data.downloadPath.trim()
          ? result.data
          : { ...result.data, downloadPath: apiDefaultDownloadDir }
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
    const validated = WebAppSettingsSchema.parse({
      ...nextSettings,
      downloadPath: nextSettings.downloadPath.trim() || apiDefaultDownloadDir
    })
    await mkdir(apiDataDir, { recursive: true })
    await writeFile(apiSettingsFile, JSON.stringify(validated), 'utf-8')
    this.settings = validated
    return this.settings
  }
}

export const webSettingsStore = new WebSettingsStore()

/**
 * Project stored Web settings onto the settings accepted by the download executor.
 *
 * @param settings Validated Web application settings.
 * @returns Runtime settings for one queued download.
 */
export const toWebDownloadRuntimeSettings = (
  settings: WebAppSettings
): DownloadRuntimeSettings => ({
  downloadPath: settings.downloadPath,
  browserForCookies: settings.browserForCookies,
  cookiesPath: settings.cookiesPath,
  proxy: settings.proxy,
  configPath: settings.configPath,
  downloadSubtitles: settings.downloadSubtitles,
  subtitleLanguages: settings.subtitleLanguages,
  interfaceLanguage: settings.language,
  embedSubs: settings.embedSubs,
  writeAutoSubs: settings.writeAutoSubs,
  embedThumbnail: settings.embedThumbnail,
  embedMetadata: settings.embedMetadata,
  embedChapters: settings.embedChapters,
  filenameStyle: settings.filenameStyle,
  filenameViaVidBee: settings.filenameViaVidBee,
  shareWatermark: settings.shareWatermark
})
