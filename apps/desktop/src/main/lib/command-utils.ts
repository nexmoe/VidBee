import {
  appendYouTubeSafeExtractorArgs as appendSharedYouTubeSafeExtractorArgs,
  buildVideoInfoArgs as buildSharedVideoInfoArgs,
  formatYtDlpCommand,
  resolveFfmpegLocationFromPath,
  type YtDlpDownloadSettings
} from '@vidbee/downloader-core/yt-dlp-args'
import type { settingsManager } from '../settings'
import { ytdlpManager } from './ytdlp-manager'

const toSharedSettings = (
  settings: ReturnType<typeof settingsManager.getAll>
): YtDlpDownloadSettings => ({
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
