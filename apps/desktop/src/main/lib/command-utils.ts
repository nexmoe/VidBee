import {
  appendYouTubeSafeExtractorArgs as appendSharedYouTubeSafeExtractorArgs,
  buildCaptionExtractArgs as buildSharedCaptionExtractArgs,
  buildPlaylistInfoArgs as buildSharedPlaylistInfoArgs,
  buildVideoInfoArgs as buildSharedVideoInfoArgs,
  formatYtDlpCommand,
  resolveFfmpegLocationFromPath,
  type YtDlpDownloadSettings
} from '@vidbee/downloader-core/yt-dlp-args'
import type { settingsManager } from '../settings'
import { ytdlpManager } from './ytdlp-manager'

export const toSharedSettings = (
  settings: ReturnType<typeof settingsManager.getAll>
): YtDlpDownloadSettings => ({
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

export { formatYtDlpCommand }

export const resolveFfmpegLocation = (ffmpegPath: string): string =>
  resolveFfmpegLocationFromPath(ffmpegPath)

export const appendJsRuntimeArgs = (args: string[]): void => {
  const runtimeArgs = ytdlpManager.getJsRuntimeArgs()
  if (runtimeArgs.length > 0) {
    args.push(...runtimeArgs)
  }
}

export const appendYouTubeSafeExtractorArgs = (args: string[], url: string): void =>
  appendSharedYouTubeSafeExtractorArgs(args, url)

export const buildVideoInfoArgs = (
  url: string,
  settings: ReturnType<typeof settingsManager.getAll>
): string[] =>
  buildSharedVideoInfoArgs(url, toSharedSettings(settings), ytdlpManager.getJsRuntimeArgs())

/** Build skip-download caption sidecar arguments with the same host settings and runtime. */
export const buildCaptionExtractArgs = (
  url: string,
  outputTemplate: string,
  settings: ReturnType<typeof settingsManager.getAll>,
  subtitleLanguages = 'all'
): string[] =>
  buildSharedCaptionExtractArgs(
    url,
    outputTemplate,
    toSharedSettings(settings),
    ytdlpManager.getJsRuntimeArgs(),
    subtitleLanguages
  )

/** Build playlist metadata arguments with the same host settings and runtime. */
export const buildPlaylistInfoArgs = (
  url: string,
  settings: ReturnType<typeof settingsManager.getAll>
): string[] =>
  buildSharedPlaylistInfoArgs(url, toSharedSettings(settings), ytdlpManager.getJsRuntimeArgs())
