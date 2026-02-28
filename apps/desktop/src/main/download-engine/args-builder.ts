import {
  buildDownloadArgs as buildSharedDownloadArgs,
  resolveAudioFormatSelector as resolveSharedAudioFormatSelector,
  resolveVideoFormatSelector as resolveSharedVideoFormatSelector,
  sanitizeFilenameTemplate as sanitizeSharedFilenameTemplate,
  type YtDlpDownloadOptions,
  type YtDlpDownloadSettings
} from '@vidbee/downloader-core/yt-dlp-args'
import type { AppSettings, DownloadOptions } from '../../shared/types'

const toSharedOptions = (options: DownloadOptions): YtDlpDownloadOptions => ({
  url: options.url,
  type: options.type,
  format: options.format,
  audioFormat: options.audioFormat,
  audioFormatIds: options.audioFormatIds,
  startTime: options.startTime,
  endTime: options.endTime,
  customDownloadPath: options.customDownloadPath,
  customFilenameTemplate: options.customFilenameTemplate
})

const toSharedSettings = (settings: AppSettings): YtDlpDownloadSettings => ({
  downloadPath: settings.downloadPath,
  browserForCookies: settings.browserForCookies,
  cookiesPath: settings.cookiesPath,
  proxy: settings.proxy,
  configPath: settings.configPath,
  embedSubs: settings.embedSubs,
  embedThumbnail: settings.embedThumbnail,
  embedMetadata: settings.embedMetadata,
  embedChapters: settings.embedChapters
})

export const sanitizeFilenameTemplate = (template: string): string =>
  sanitizeSharedFilenameTemplate(template)

export const resolveVideoFormatSelector = (options: DownloadOptions): string =>
  resolveSharedVideoFormatSelector(toSharedOptions(options))

export const resolveAudioFormatSelector = (options: DownloadOptions): string =>
  resolveSharedAudioFormatSelector(toSharedOptions(options))

export const buildDownloadArgs = (
  options: DownloadOptions,
  downloadPath: string,
  settings: AppSettings,
  jsRuntimeArgs: string[] = []
): string[] =>
  buildSharedDownloadArgs(
    toSharedOptions(options),
    downloadPath,
    toSharedSettings(settings),
    jsRuntimeArgs
  )
