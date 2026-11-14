import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { buildBrowserCookiesSetting } from './browser-cookies-setting'
import { getBrowserProfileBaseDirs, getBrowserProfileCandidates } from './cookie-browser-paths'
import {
  buildCaptionExtractArgs,
  buildDownloadArgs,
  buildPlaylistInfoArgs,
  buildVideoInfoArgs,
  normalizeBrowserCookiesSettingForYtDlp
} from './yt-dlp-args'

const TEST_URL = 'https://example.test/watch?v=521'
const SYNTHETIC_DOWNLOAD_PATH = '/synthetic-downloads'
const ORIGIN_PROFILE = '/synthetic-home/.config/BraveSoftware/Brave-Origin/Default'
const CHROMIUM_BROWSERS = ['brave', 'chrome', 'chromium', 'edge', 'opera', 'vivaldi', 'whale']
const ABSOLUTE_PROFILES = [
  ORIGIN_PROFILE,
  '/synthetic-home/Custom Chromium/User Data/Profile 2',
  String.raw`C:\Synthetic Home\Custom Chromium\User Data\Profile 2`,
  'C:/Synthetic Home/Custom Chromium/User Data/Profile 2',
  String.raw`\\synthetic-server\browser-profiles\Profile 2`
]

const buildCookieArgs = (browserForCookies?: string) => {
  const settings = { browserForCookies }
  return [
    { operation: 'metadata', args: buildVideoInfoArgs(TEST_URL, settings) },
    {
      operation: 'video download',
      args: buildDownloadArgs({ url: TEST_URL, type: 'video' }, SYNTHETIC_DOWNLOAD_PATH, settings)
    },
    {
      operation: 'audio download',
      args: buildDownloadArgs({ url: TEST_URL, type: 'audio' }, SYNTHETIC_DOWNLOAD_PATH, settings)
    },
    {
      operation: 'captions',
      args: buildCaptionExtractArgs(TEST_URL, `${SYNTHETIC_DOWNLOAD_PATH}/captions`, settings)
    },
    { operation: 'playlist', args: buildPlaylistInfoArgs(TEST_URL, settings) }
  ]
}

for (const browser of CHROMIUM_BROWSERS) {
  test(`${browser} preserves absolute custom profiles in normalization and every argv builder`, () => {
    for (const profile of ABSOLUTE_PROFILES) {
      const setting = buildBrowserCookiesSetting(browser, profile)
      assert.equal(normalizeBrowserCookiesSettingForYtDlp(setting), setting)
      for (const { operation, args } of buildCookieArgs(setting)) {
        assert.equal(args[args.indexOf('--cookies-from-browser') + 1], setting, operation)
      }
    }
  })
}

for (const { operation, args } of buildCookieArgs(`brave:${ORIGIN_PROFILE}`)) {
  test(`${operation} passes the configured Brave Origin path as one argument`, () => {
    assert.equal(args[args.indexOf('--cookies-from-browser') + 1], `brave:${ORIGIN_PROFILE}`)
  })
}

for (const browser of [...CHROMIUM_BROWSERS, 'firefox']) {
  test(`${browser} keeps automatic and named profile selection`, () => {
    for (const setting of [browser, `${browser}:Default`, `${browser}:Profile 2`]) {
      assert.equal(normalizeBrowserCookiesSettingForYtDlp(setting), setting)
      for (const { operation, args } of buildCookieArgs(setting)) {
        assert.equal(args[args.indexOf('--cookies-from-browser') + 1], setting, operation)
      }
    }
  })
}

for (const value of [undefined, null, '', '   ', 'none', ' none ']) {
  test(`disabled cookies (${String(value)}) omit the browser flag`, () => {
    assert.equal(normalizeBrowserCookiesSettingForYtDlp(value), 'none')
    for (const { operation, args } of buildCookieArgs(value ?? undefined)) {
      assert.equal(args.includes('--cookies-from-browser'), false, operation)
    }
  })
}

test('Safari ignores explicit profiles', () => {
  for (const profile of ['', ORIGIN_PROFILE, 'Profile 2']) {
    const setting = buildBrowserCookiesSetting('safari', profile)
    assert.equal(normalizeBrowserCookiesSettingForYtDlp(setting), 'safari')
    for (const { operation, args } of buildCookieArgs(setting)) {
      assert.equal(args[args.indexOf('--cookies-from-browser') + 1], 'safari', operation)
    }
  }
})

test('quoted absolute profile paths are unquoted without losing directories', () => {
  for (const quote of ['"', "'"]) {
    const setting = `brave:${quote}${ORIGIN_PROFILE}${quote}`
    assert.equal(normalizeBrowserCookiesSettingForYtDlp(setting), `brave:${ORIGIN_PROFILE}`)
  }
})

test('relative profile paths keep the existing basename fallback', () => {
  for (const profile of ['User Data/Profile 2', String.raw`User Data\Profile 2`]) {
    assert.equal(normalizeBrowserCookiesSettingForYtDlp(`chrome:${profile}`), 'chrome:Profile 2')
  }
})

for (const hasCookieDatabase of [true, false]) {
  test(`Firefox keeps its absolute-path behavior with cookies.sqlite=${hasCookieDatabase}`, (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'vidbee-521-firefox-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const profile = path.join(root, 'Custom Firefox', 'synthetic.default-release')
    mkdirSync(profile, { recursive: true })
    if (hasCookieDatabase) {
      writeFileSync(path.join(profile, 'cookies.sqlite'), 'synthetic fixture')
    }
    const setting = buildBrowserCookiesSetting('firefox', profile)
    const expected = hasCookieDatabase ? setting : 'firefox:synthetic.default-release'
    assert.equal(normalizeBrowserCookiesSettingForYtDlp(setting), expected)
    for (const { operation, args } of buildCookieArgs(setting)) {
      assert.equal(args[args.indexOf('--cookies-from-browser') + 1], expected, operation)
    }
  })
}

test('Linux Brave detection keeps Brave-Browser first and also probes Brave-Origin', () => {
  assert.deepEqual(getBrowserProfileBaseDirs('linux', '/synthetic-home', 'brave'), [
    '/synthetic-home/.config/BraveSoftware/Brave-Browser',
    '/synthetic-home/.config/BraveSoftware/Brave-Origin'
  ])
  assert.deepEqual(getBrowserProfileCandidates('linux', '/synthetic-home', 'brave'), [
    '/synthetic-home/.config/BraveSoftware/Brave-Browser/Default',
    '/synthetic-home/.config/BraveSoftware/Brave-Browser/Profile 1',
    ORIGIN_PROFILE,
    '/synthetic-home/.config/BraveSoftware/Brave-Origin/Profile 1'
  ])
})

for (const variant of ['Brave-Origin', 'Brave-Browser']) {
  test(`an isolated Linux ${variant} fixture can be detected and passed to yt-dlp`, (t) => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'vidbee-521-brave-'))
    t.after(() => rmSync(home, { recursive: true, force: true }))
    const profile = path.join(home, '.config', 'BraveSoftware', variant, 'Default')
    mkdirSync(profile, { recursive: true })
    writeFileSync(path.join(profile, 'Cookies'), 'synthetic fixture')
    assert.ok(getBrowserProfileBaseDirs('linux', home, 'brave').some(existsSync))
    const detectedProfile = getBrowserProfileCandidates('linux', home, 'brave').find(existsSync)
    assert.equal(detectedProfile, profile)
    const setting = buildBrowserCookiesSetting('brave', detectedProfile ?? '')
    for (const { operation, args } of buildCookieArgs(setting)) {
      assert.equal(args[args.indexOf('--cookies-from-browser') + 1], setting, operation)
    }
  })
}
