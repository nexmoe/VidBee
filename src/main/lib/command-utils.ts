import path from 'node:path'
import type { settingsManager } from '../settings'
import { resolvePathWithHome } from '../utils/path-helpers'
import { ytdlpManager } from './ytdlp-manager'

export const formatYtDlpCommand = (args: string[]): string => {
  const quoted = args.map((arg) => {
    if (arg === '') {
      return '""'
    }
    if (/[\s"'\\]/.test(arg)) {
      return `"${arg.replace(/(["\\])/g, '\\$1')}"`
    }
    return arg
  })
  return `yt-dlp ${quoted.join(' ')}`
}

export const resolveFfmpegLocation = (ffmpegPath: string): string => path.dirname(ffmpegPath)

export const appendJsRuntimeArgs = (args: string[]): void => {
  const runtimeArgs = ytdlpManager.getJsRuntimeArgs()
  if (runtimeArgs.length > 0) {
    args.push(...runtimeArgs)
  }
}

export const buildVideoInfoArgs = (
  url: string,
  settings: ReturnType<typeof settingsManager.getAll>
) => {
  const args = ['-j', '--no-playlist', '--no-warnings']

  // Add encoding support for proper handling of non-ASCII characters
  args.push('--encoding', 'utf-8')

  // Note: Some sites (e.g., YouTube) may not provide filesize information
  // in the initial request. This is normal behavior and filesize may be null/undefined
  // for many formats. File size information might require additional HTTP HEAD requests
  // which would significantly slow down info extraction, so yt-dlp doesn't fetch it by default.

  // Add proxy if configured
  if (settings.proxy) {
    args.push('--proxy', settings.proxy)
  }

  // Add browser cookies if configured (skip if 'none')
  if (settings.browserForCookies && settings.browserForCookies !== 'none') {
    args.push('--cookies-from-browser', settings.browserForCookies)
  }

  const cookiesPath = settings.cookiesPath?.trim()
  if (cookiesPath) {
    args.push('--cookies', cookiesPath)
  }

  // Add config file if configured
  const configPath = resolvePathWithHome(settings.configPath)
  if (configPath) {
    args.push('--config-location', configPath)
  }

  appendJsRuntimeArgs(args)
  args.push(url)

  return args
}
