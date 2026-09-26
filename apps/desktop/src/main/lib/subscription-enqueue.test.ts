import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DownloadRuntimeSettings } from '@vidbee/downloader-core'
import { YtDlpExecutor } from '@vidbee/downloader-core'
import type { TaskInput } from '@vidbee/task-queue'
import { type AppSettings, defaultSettings } from '../../shared/types'
import { toSharedSettings } from '../download-engine/args-builder'
import {
  buildDesktopSubscriptionTaskInput,
  type SubscriptionDownloadItem,
  type SubscriptionDownloadSource
} from './subscription-enqueue'

const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

const subscription: SubscriptionDownloadSource = {
  id: 'sub-1',
  platform: 'youtube',
  tags: ['releases'],
  downloadDirectory: '/videos/feeds',
  namingTemplate: '%(title)s [%(id)s]/%(title)s.%(ext)s'
}

const item: SubscriptionDownloadItem = {
  id: 'item-1',
  url: VIDEO_URL,
  title: 'Example',
  thumbnail: 'https://example.com/thumb.jpg'
}

const settingsFor = (patch: Partial<AppSettings>): AppSettings => ({
  ...defaultSettings,
  downloadPath: '/videos',
  ...patch
})

const CHOICE_FLAGS = [
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

const projectDownloadChoices = (args: readonly string[]): string[] => {
  const wanted = new Set<string>(CHOICE_FLAGS)
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
  defaultDownloadDir: '/videos'
})

const choicesFor = (input: TaskInput): string[] => {
  const command = executor.describeCommandFor(input)
  const body = command.startsWith('yt-dlp ') ? command.slice('yt-dlp '.length) : command
  return projectDownloadChoices(body.split(' '))
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

const manualTask = (settings: DownloadRuntimeSettings): TaskInput => ({
  url: VIDEO_URL,
  kind: 'video',
  options: {
    type: 'video',
    customDownloadPath: '/videos/feeds',
    settings
  }
})

test('automatic and manual feed items snapshot the same subtitle, cookie, and proxy settings', () => {
  const profiles: Array<{ name: string; settings: AppSettings; expected: string[] }> = [
    {
      name: 'sidecar',
      settings: settingsFor({
        downloadSubtitles: true,
        embedSubs: false,
        writeAutoSubs: false,
        subtitleLanguages: ['ja', 'en'],
        language: 'zh',
        browserForCookies: 'firefox',
        cookiesPath: '/tmp/vidbee-cookies.txt',
        proxy: 'http://127.0.0.1:7890'
      }),
      expected: [
        '--write-subs',
        '--no-embed-subs',
        '--no-write-auto-subs',
        'ja',
        'en',
        'firefox',
        '/tmp/vidbee-cookies.txt',
        'http://127.0.0.1:7890'
      ]
    },
    {
      name: 'embed',
      settings: settingsFor({
        downloadSubtitles: true,
        embedSubs: true,
        writeAutoSubs: true,
        subtitleLanguages: ['interface'],
        language: 'de',
        browserForCookies: 'chrome',
        cookiesPath: '',
        proxy: 'socks5://127.0.0.1:1080'
      }),
      expected: [
        '--write-subs',
        '--embed-subs',
        '--write-auto-subs',
        'de',
        'chrome',
        'socks5://127.0.0.1:1080'
      ]
    },
    {
      name: 'subtitles-off',
      settings: settingsFor({
        downloadSubtitles: false,
        embedSubs: true,
        writeAutoSubs: true,
        subtitleLanguages: ['en'],
        browserForCookies: 'none',
        cookiesPath: '/tmp/vidbee-cookies.txt',
        proxy: 'http://127.0.0.1:8080'
      }),
      expected: [
        '--no-write-subs',
        '--no-write-auto-subs',
        '--no-embed-subs',
        '/tmp/vidbee-cookies.txt',
        'http://127.0.0.1:8080'
      ]
    }
  ]

  for (const profile of profiles) {
    const snapshot = toSharedSettings(profile.settings)
    const auto = buildDesktopSubscriptionTaskInput({
      settings: profile.settings,
      subscription,
      item,
      trigger: 'auto'
    })
    const manualQueue = buildDesktopSubscriptionTaskInput({
      settings: profile.settings,
      subscription,
      item,
      trigger: 'manual',
      creation: {
        origin: 'agent',
        agentConversation: { downloadId: 'd', threadId: 't', promptId: 'p' }
      }
    })

    assert.deepEqual(auto.task.options?.settings, snapshot, profile.name)
    assert.deepEqual(manualQueue.task.options?.settings, snapshot, profile.name)
    assert.equal(auto.task.options?.origin, 'subscription', profile.name)
    assert.equal(manualQueue.task.options?.origin, 'agent', profile.name)
    assert.equal(
      auto.task.options?.customFilenameTemplate,
      '%(title)s [%(id)s]/%(title)s.%(ext)s',
      profile.name
    )

    const autoChoices = choicesFor(auto.task)
    const manualChoices = choicesFor(manualTask(snapshot))
    assert.deepEqual(autoChoices, manualChoices, profile.name)
    assert.deepEqual(choicesFor(manualQueue.task), manualChoices, profile.name)
    for (const token of profile.expected) {
      assert.equal(hasChoice(autoChoices, token), true, `${profile.name} missing ${token}`)
    }
    if (profile.name === 'subtitles-off') {
      assert.equal(hasChoice(autoChoices, '--write-subs'), false, profile.name)
      assert.equal(hasChoice(autoChoices, '--embed-subs'), false, profile.name)
      assert.equal(hasChoice(autoChoices, '--sub-langs'), false, profile.name)
    }
    if (profile.name === 'embed') {
      assert.equal(hasChoice(autoChoices, '--no-embed-subs'), false, profile.name)
      assert.equal(hasChoice(autoChoices, '--no-write-subs'), false, profile.name)
    }
    if (profile.name === 'sidecar') {
      assert.equal(hasChoice(autoChoices, '--embed-subs'), false, profile.name)
      assert.equal(hasChoice(autoChoices, '--write-auto-subs'), false, profile.name)
      assert.equal(hasChoice(autoChoices, 'zh'), false, profile.name)
      assert.equal(hasChoice(autoChoices, 'zh-Hans'), false, profile.name)
    }
  }
})
