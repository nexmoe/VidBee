import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TaskInput } from '@vidbee/task-queue'
import type { DownloadRuntimeSettings } from './types'
import { buildDownloadArgs, type YtDlpDownloadOptions } from './yt-dlp-args'
import { YtDlpExecutor } from './yt-dlp-executor'

const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const DOWNLOAD_DIR = '/videos'

const video = (url = VIDEO_URL): YtDlpDownloadOptions => ({ url, type: 'video' })

const flagValue = (args: readonly string[], flag: string): string | undefined => {
  const index = args.indexOf(flag)
  if (index === -1) {
    return undefined
  }
  return args[index + 1]
}

const languageTokens = (args: readonly string[]): string[] =>
  (flagValue(args, '--sub-langs') ?? '').split(',').filter((token) => token !== '')

const NETWORK_AND_SUBTITLE_FLAGS = [
  '--cookies',
  '--cookies-from-browser',
  '--embed-subs',
  '--no-embed-subs',
  '--no-write-auto-subs',
  '--no-write-subs',
  '--proxy',
  '--sub-langs',
  '--write-auto-subs',
  '--write-subs'
] as const

/** Keep the flags that must match between a manual download and an RSS item. */
const projectDownloadChoices = (args: readonly string[]): string[] => {
  const wanted = new Set<string>(NETWORK_AND_SUBTITLE_FLAGS)
  const projected: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!(arg && wanted.has(arg))) {
      continue
    }
    projected.push(arg)
    const value = args[index + 1]
    if (value && !value.startsWith('--')) {
      projected.push(value)
      index += 1
    }
  }
  return projected
}

const executor = new YtDlpExecutor({
  resolveYtDlpPath: () => 'yt-dlp',
  resolveFfmpegLocation: () => undefined,
  defaultDownloadDir: DOWNLOAD_DIR
})

const describeChoices = (input: TaskInput): string[] => {
  const command = executor.describeCommandFor(input)
  const tokens = command.startsWith('yt-dlp ') ? command.slice('yt-dlp '.length).split(' ') : []
  return projectDownloadChoices(tokens)
}

const hasChoice = (choices: readonly string[], token: string): boolean => {
  if (choices.includes(token)) {
    return true
  }
  const index = choices.indexOf('--sub-langs')
  if (index === -1) {
    return false
  }
  return (choices[index + 1] ?? '').split(',').includes(token)
}

test('embedding keeps the separate subtitle file', () => {
  const args = buildDownloadArgs(video(), DOWNLOAD_DIR, {
    downloadSubtitles: true,
    embedSubs: true,
    writeAutoSubs: true,
    subtitleLanguages: ['en'],
    interfaceLanguage: 'en'
  })

  assert.equal(args.includes('--write-subs'), true)
  assert.equal(args.includes('--embed-subs'), true)
  assert.equal(args.includes('--write-auto-subs'), true)
  assert.equal(args.includes('--no-embed-subs'), false)
  assert.equal(args.includes('--no-write-subs'), false)
  assert.ok(languageTokens(args).includes('en'))
})

test('sidecar mode writes subtitles without embedding them', () => {
  const args = buildDownloadArgs(video(), DOWNLOAD_DIR, {
    downloadSubtitles: true,
    embedSubs: false,
    writeAutoSubs: false,
    subtitleLanguages: ['ja', 'en'],
    interfaceLanguage: 'zh-CN',
    browserForCookies: 'firefox',
    cookiesPath: '/tmp/vidbee-cookies.txt',
    proxy: 'http://127.0.0.1:7890'
  })

  assert.equal(args.includes('--write-subs'), true)
  assert.equal(args.includes('--no-embed-subs'), true)
  assert.equal(args.includes('--no-write-auto-subs'), true)
  assert.equal(args.includes('--embed-subs'), false)
  assert.equal(args.includes('--write-auto-subs'), false)
  assert.deepEqual(
    languageTokens(args).filter((token) => token === 'ja' || token === 'en'),
    ['ja', 'en']
  )
  assert.equal(languageTokens(args).includes('zh-CN'), false)
  assert.equal(flagValue(args, '--cookies-from-browser'), 'firefox')
  assert.equal(flagValue(args, '--cookies'), '/tmp/vidbee-cookies.txt')
  assert.equal(flagValue(args, '--proxy'), 'http://127.0.0.1:7890')
})

test('disabled subtitles opt out of writing, automatic captions, and embedding', () => {
  const args = buildDownloadArgs(video(), DOWNLOAD_DIR, {
    downloadSubtitles: false,
    embedSubs: true,
    writeAutoSubs: true,
    subtitleLanguages: ['en'],
    proxy: 'http://127.0.0.1:7890',
    cookiesPath: '/tmp/vidbee-cookies.txt'
  })

  assert.equal(args.includes('--no-write-subs'), true)
  assert.equal(args.includes('--no-write-auto-subs'), true)
  assert.equal(args.includes('--no-embed-subs'), true)
  assert.equal(args.includes('--write-subs'), false)
  assert.equal(args.includes('--embed-subs'), false)
  assert.equal(args.includes('--sub-langs'), false)
  assert.equal(flagValue(args, '--proxy'), 'http://127.0.0.1:7890')
  assert.equal(flagValue(args, '--cookies'), '/tmp/vidbee-cookies.txt')
})

test('bilibili subtitles stay sidecar files even when embedding is on', () => {
  const args = buildDownloadArgs(
    { url: 'https://www.bilibili.com/video/BV1xx411c7mD', type: 'video' },
    DOWNLOAD_DIR,
    {
      downloadSubtitles: true,
      embedSubs: true,
      writeAutoSubs: false,
      subtitleLanguages: ['zh-Hans'],
      interfaceLanguage: 'zh-CN',
      cookiesPath: '/tmp/vidbee-cookies.txt'
    }
  )

  assert.equal(args.includes('--write-subs'), true)
  assert.equal(args.includes('--no-embed-subs'), true)
  assert.equal(args.includes('--embed-subs'), false)
})

test('manual and RSS tasks with the same settings snapshot request the same subtitles', () => {
  const settings: DownloadRuntimeSettings = {
    downloadPath: DOWNLOAD_DIR,
    downloadSubtitles: true,
    embedSubs: false,
    writeAutoSubs: true,
    subtitleLanguages: ['interface'],
    interfaceLanguage: 'ja',
    browserForCookies: 'chrome',
    cookiesPath: '/tmp/vidbee-cookies.txt',
    proxy: 'socks5://127.0.0.1:1080'
  }
  const manual: TaskInput = {
    url: VIDEO_URL,
    kind: 'video',
    options: { type: 'video', settings }
  }
  const rss: TaskInput = {
    url: VIDEO_URL,
    kind: 'subscription-item',
    options: { type: 'video', origin: 'subscription', settings }
  }
  const omitted: TaskInput = {
    url: VIDEO_URL,
    kind: 'subscription-item',
    options: { type: 'video', origin: 'subscription' }
  }

  const manualChoices = describeChoices(manual)
  const rssChoices = describeChoices(rss)
  assert.deepEqual(rssChoices, manualChoices)
  assert.equal(hasChoice(manualChoices, '--write-subs'), true)
  assert.equal(hasChoice(manualChoices, '--no-embed-subs'), true)
  assert.equal(hasChoice(manualChoices, '--write-auto-subs'), true)
  assert.equal(hasChoice(manualChoices, '--embed-subs'), false)
  assert.equal(hasChoice(manualChoices, 'ja'), true)
  assert.equal(hasChoice(manualChoices, 'chrome'), true)
  assert.equal(hasChoice(manualChoices, '/tmp/vidbee-cookies.txt'), true)
  assert.equal(hasChoice(manualChoices, 'socks5://127.0.0.1:1080'), true)

  const omittedChoices = describeChoices(omitted)
  assert.notDeepEqual(omittedChoices, manualChoices)
  assert.equal(hasChoice(omittedChoices, '--embed-subs'), true)
  assert.equal(hasChoice(omittedChoices, '--write-subs'), true)
  assert.equal(hasChoice(omittedChoices, 'socks5://127.0.0.1:1080'), false)
  assert.equal(hasChoice(omittedChoices, 'ja'), false)
  assert.equal(hasChoice(omittedChoices, 'en'), true)
})
