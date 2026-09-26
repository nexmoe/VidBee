import {
  appendYouTubeSafeExtractorArgs as appendSharedYouTubeSafeExtractorArgs,
  buildCaptionExtractArgs as buildSharedCaptionExtractArgs,
  buildPlaylistInfoArgs as buildSharedPlaylistInfoArgs,
  buildVideoInfoArgs as buildSharedVideoInfoArgs,
  formatYtDlpCommand,
  resolveFfmpegLocationFromPath
} from '@vidbee/downloader-core/yt-dlp-args'
import { toSharedSettings } from '../download-engine/args-builder'
import type { settingsManager } from '../settings'
import { ytdlpManager } from './ytdlp-manager'

export { formatYtDlpCommand, toSharedSettings }

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
