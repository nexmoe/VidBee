import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  getBrowserCookieDatabaseName,
  getBrowserProfileBaseDirs,
  getBrowserProfileCandidates
} from '@vidbee/downloader-core/cookie-browser-paths'
import {
  COOKIE_BROWSER_IDS,
  type CookieHealth,
  getMaxCookiesFileBytes,
  type InstalledCookieBrowser,
  inspectNetscapeCookies,
  isBrowserCookieReadSupported,
  looksLikeNetscapeCookies,
  unconfiguredCookieHealth
} from '@vidbee/downloader-core/cookie-setup'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { ExtensionCookieConnection } from '../../../shared/extension-cookies'
import { inspectBrowserCookieAccess } from '../../lib/browser-cookie-access'
import { extensionCookieHealth, getExtensionCookieConnection } from '../../lib/extension-cookies'
import { resolvePathWithHome } from '../../utils/path-helpers'

class BrowserCookiesService extends IpcService {
  static readonly groupName = 'browserCookies'

  /**
   * Build a profile-path validation payload.
   *
   * @param valid Whether the path can be used.
   * @param reason Optional failure reason.
   */
  private buildValidationResult(valid: boolean, reason?: string) {
    if (valid) {
      return { valid }
    }
    return { valid, reason }
  }

  /**
   * True when the path exists and is a directory.
   *
   * @param target Path to test.
   */
  private isDirectory(target: string): boolean {
    try {
      return fs.statSync(target).isDirectory()
    } catch {
      return false
    }
  }

  /**
   * Return the first existing directory from a candidate list.
   *
   * @param paths Candidate directories.
   */
  private pickFirstDirectory(paths: string[]): string {
    for (const candidate of paths) {
      if (this.isDirectory(candidate)) {
        return candidate
      }
    }
    return ''
  }

  /**
   * Strip quotes and surrounding whitespace from a profile field.
   *
   * @param value Raw profile input.
   */
  private normalizeProfileInput(value: string): string {
    return value.trim().replace(/^['"]|['"]$/g, '')
  }

  /**
   * Pick the default Firefox profile folder under a Profiles directory.
   *
   * @param profilesDir Firefox Profiles directory.
   */
  private findFirefoxProfilePath(profilesDir: string): string {
    if (!this.isDirectory(profilesDir)) {
      return ''
    }

    const entries = fs
      .readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))

    const preferred =
      entries.find((name) => name.endsWith('.default-release')) ??
      entries.find((name) => name.endsWith('.default')) ??
      entries[0]

    return preferred ? path.join(profilesDir, preferred) : ''
  }

  /**
   * Detect installed browsers that have a profile directory on disk.
   */
  @IpcMethod()
  listInstalledBrowsers(_context: IpcContext): InstalledCookieBrowser[] {
    const platform = os.platform()
    const homeDir = os.homedir()
    const installed: InstalledCookieBrowser[] = []

    for (const browser of COOKIE_BROWSER_IDS) {
      const baseDirs = getBrowserProfileBaseDirs(platform, homeDir, browser)
      if (!baseDirs.some((dir) => this.isDirectory(dir))) {
        continue
      }
      installed.push({
        id: browser,
        supported: isBrowserCookieReadSupported(platform, browser)
      })
    }

    return installed
  }

  /**
   * Return whether a VidBee browser extension is connected for live cookies.
   */
  @IpcMethod()
  getExtensionConnection(_context: IpcContext): ExtensionCookieConnection {
    return getExtensionCookieConnection()
  }

  /**
   * Inspect the current cookie source and report whether it looks usable.
   *
   * @param _context IPC context.
   * @param input Browser setting plus optional cookies file path.
   */
  @IpcMethod()
  async inspectCookieHealth(
    _context: IpcContext,
    input: { browser: string; profile: string; cookiesPath: string }
  ): Promise<CookieHealth> {
    const extension = extensionCookieHealth()
    if (extension) {
      return extension
    }
    const cookiesPath = input.cookiesPath?.trim()
    if (cookiesPath) {
      return await this.inspectCookiesFileHealth(cookiesPath)
    }

    const browser = input.browser?.trim()
    if (!browser || browser === 'none') {
      return unconfiguredCookieHealth()
    }

    return inspectBrowserCookieAccess(browser, input.profile ?? '')
  }

  /**
   * Resolve the default profile path for a browser, if one exists.
   *
   * @param _context IPC context.
   * @param browser Browser id.
   */
  @IpcMethod()
  getBrowserProfilePath(_context: IpcContext, browser: string): string {
    if (!browser || browser === 'none') {
      return ''
    }

    const homeDir = os.homedir()
    const platform = os.platform()
    const candidates = getBrowserProfileCandidates(platform, homeDir, browser)

    if (browser === 'firefox') {
      const profilesDir = getBrowserProfileBaseDirs(platform, homeDir, browser)[0]
      const profilePath = profilesDir ? this.findFirefoxProfilePath(profilesDir) : ''
      return profilePath || this.pickFirstDirectory(candidates)
    }

    return this.pickFirstDirectory(candidates)
  }

  /**
   * Validate a stored browser profile path or name.
   *
   * @param _context IPC context.
   * @param browser Browser id.
   * @param profilePath Profile name or absolute path.
   */
  @IpcMethod()
  validateBrowserProfilePath(
    _context: IpcContext,
    browser: string,
    profilePath: string
  ): { valid: boolean; reason?: string } {
    return this.validateProfile(browser, profilePath)
  }

  /**
   * Validate a stored browser profile path or name.
   *
   * @param browser Browser id.
   * @param profilePath Profile name or absolute path.
   */
  private validateProfile(
    browser: string,
    profilePath: string
  ): { valid: boolean; reason?: string } {
    if (!browser || browser === 'none') {
      return this.buildValidationResult(false, 'browserUnsupported')
    }

    const normalizedInput = this.normalizeProfileInput(profilePath)
    if (!normalizedInput) {
      return this.buildValidationResult(false, 'empty')
    }

    const resolvedInput = resolvePathWithHome(normalizedInput)
    if (resolvedInput && this.isDirectory(resolvedInput)) {
      // GitHub issue #331: a Firefox profile directory without cookies.sqlite
      // makes yt-dlp fail with "could not find firefox cookies database", so
      // flag it as invalid instead of reporting a misleading success.
      const cookieDb = path.join(resolvedInput, getBrowserCookieDatabaseName(browser))
      if (browser === 'firefox' && !fs.existsSync(cookieDb)) {
        return this.buildValidationResult(false, 'cookiesFileNotFound')
      }
      return this.buildValidationResult(true)
    }

    const looksLikePath =
      resolvedInput &&
      (path.isAbsolute(resolvedInput) ||
        resolvedInput.includes('/') ||
        resolvedInput.includes('\\'))
    if (looksLikePath) {
      return this.buildValidationResult(false, 'pathNotFound')
    }

    const platform = os.platform()
    const homeDir = os.homedir()
    const baseDirs = getBrowserProfileBaseDirs(platform, homeDir, browser)
    if (baseDirs.length === 0) {
      return this.buildValidationResult(false, 'browserUnsupported')
    }
    for (const baseDir of baseDirs) {
      if (!baseDir) {
        continue
      }
      const candidate = path.join(baseDir, normalizedInput)
      if (this.isDirectory(candidate)) {
        return this.buildValidationResult(true)
      }
    }

    return this.buildValidationResult(false, 'profileNotFound')
  }

  /**
   * Inspect a Netscape cookies file on disk.
   *
   * @param cookiesPath Absolute cookies.txt path.
   */
  private async inspectCookiesFileHealth(cookiesPath: string): Promise<CookieHealth> {
    const resolvedPath = resolvePathWithHome(cookiesPath) || cookiesPath
    try {
      const handle = await fs.promises.open(resolvedPath, 'r')
      try {
        const stat = await handle.stat()
        if (stat.size > getMaxCookiesFileBytes()) {
          return {
            cookiesPath: resolvedPath,
            reason: 'invalid-format',
            source: 'file',
            status: 'invalid',
            sites: []
          }
        }
        const buffer = Buffer.alloc(Math.min(stat.size, 16))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        const sample = buffer.subarray(0, bytesRead)
        if (sample.length >= 16 && sample.subarray(0, 15).toString('ascii') === 'SQLite format 3') {
          return {
            cookiesPath: resolvedPath,
            reason: 'invalid-format',
            source: 'file',
            status: 'invalid',
            sites: []
          }
        }
        if (sample.includes(0)) {
          return {
            cookiesPath: resolvedPath,
            reason: 'invalid-format',
            source: 'file',
            status: 'invalid',
            sites: []
          }
        }
      } finally {
        await handle.close().catch(() => {})
      }

      const text = await fs.promises.readFile(resolvedPath, 'utf8')
      if (!looksLikeNetscapeCookies(text)) {
        return {
          cookiesPath: resolvedPath,
          reason: 'invalid-format',
          source: 'file',
          status: 'invalid',
          sites: []
        }
      }
      return inspectNetscapeCookies(text, resolvedPath)
    } catch {
      return {
        cookiesPath: resolvedPath,
        reason: 'missing-file',
        source: 'file',
        status: 'invalid',
        sites: []
      }
    }
  }
}

export { BrowserCookiesService }
