import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import { resolvePathWithHome } from '../../utils/path-helpers'

class BrowserCookiesService extends IpcService {
  static readonly groupName = 'browserCookies'

  private buildValidationResult(valid: boolean, reason?: string) {
    if (valid) {
      return { valid }
    }
    return { valid, reason }
  }

  private isDirectory(target: string): boolean {
    try {
      return fs.statSync(target).isDirectory()
    } catch {
      return false
    }
  }

  private pickFirstDirectory(paths: string[]): string {
    for (const candidate of paths) {
      if (this.isDirectory(candidate)) {
        return candidate
      }
    }
    return ''
  }

  private normalizeProfileInput(value: string): string {
    return value.trim().replace(/^['"]|['"]$/g, '')
  }

  private getBrowserProfileBaseDirs(platform: string, homeDir: string, browser: string): string[] {
    if (platform === 'win32') {
      if (browser === 'edge') {
        return [path.join(homeDir, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data')]
      }
      if (browser === 'chrome') {
        return [path.join(homeDir, 'AppData', 'Local', 'Google', 'Chrome', 'User Data')]
      }
      if (browser === 'chromium') {
        return [path.join(homeDir, 'AppData', 'Local', 'Chromium', 'User Data')]
      }
      if (browser === 'brave') {
        return [
          path.join(homeDir, 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data')
        ]
      }
      if (browser === 'vivaldi') {
        return [path.join(homeDir, 'AppData', 'Local', 'Vivaldi', 'User Data')]
      }
      if (browser === 'whale') {
        return [path.join(homeDir, 'AppData', 'Local', 'Naver', 'Whale', 'User Data')]
      }
      if (browser === 'opera') {
        return [path.join(homeDir, 'AppData', 'Roaming', 'Opera Software', 'Opera Stable')]
      }
      if (browser === 'firefox') {
        return [path.join(homeDir, 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles')]
      }
    }

    if (platform === 'darwin') {
      if (browser === 'edge') {
        return [path.join(homeDir, 'Library', 'Application Support', 'Microsoft Edge')]
      }
      if (browser === 'chrome') {
        return [path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome')]
      }
      if (browser === 'chromium') {
        return [path.join(homeDir, 'Library', 'Application Support', 'Chromium')]
      }
      if (browser === 'brave') {
        return [
          path.join(homeDir, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')
        ]
      }
      if (browser === 'vivaldi') {
        return [path.join(homeDir, 'Library', 'Application Support', 'Vivaldi')]
      }
      if (browser === 'whale') {
        return [
          path.join(homeDir, 'Library', 'Application Support', 'Whale'),
          path.join(homeDir, 'Library', 'Application Support', 'Naver Whale')
        ]
      }
      if (browser === 'opera') {
        return [
          path.join(homeDir, 'Library', 'Application Support', 'com.operasoftware.Opera'),
          path.join(homeDir, 'Library', 'Application Support', 'Opera Software', 'Opera Stable')
        ]
      }
      if (browser === 'firefox') {
        return [path.join(homeDir, 'Library', 'Application Support', 'Firefox', 'Profiles')]
      }
      if (browser === 'safari') {
        return [path.join(homeDir, 'Library', 'Safari')]
      }
    }

    if (platform === 'linux') {
      if (browser === 'edge') {
        return [path.join(homeDir, '.config', 'microsoft-edge')]
      }
      if (browser === 'chrome') {
        return [path.join(homeDir, '.config', 'google-chrome')]
      }
      if (browser === 'chromium') {
        return [path.join(homeDir, '.config', 'chromium')]
      }
      if (browser === 'brave') {
        return [path.join(homeDir, '.config', 'BraveSoftware', 'Brave-Browser')]
      }
      if (browser === 'vivaldi') {
        return [path.join(homeDir, '.config', 'vivaldi')]
      }
      if (browser === 'whale') {
        return [path.join(homeDir, '.config', 'naver-whale')]
      }
      if (browser === 'opera') {
        return [path.join(homeDir, '.config', 'opera')]
      }
      if (browser === 'firefox') {
        return [path.join(homeDir, '.mozilla', 'firefox')]
      }
    }

    if (platform === 'freebsd') {
      if (browser === 'firefox') {
        return [path.join(homeDir, '.mozilla', 'firefox')]
      }
    }

    return []
  }

  private getDefaultProfilePath(baseDirs: string[], browser: string): string {
    const base = baseDirs[0]
    if (!base) {
      return ''
    }

    if (browser === 'firefox' || browser === 'safari' || browser === 'opera') {
      return base
    }

    return path.join(base, 'Default')
  }

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

  @IpcMethod()
  getBrowserProfilePath(_context: IpcContext, browser: string): string {
    if (!browser || browser === 'none') {
      return ''
    }

    const homeDir = os.homedir()
    const platform = os.platform()
    const baseDirs = this.getBrowserProfileBaseDirs(platform, homeDir, browser)
    const fallbackPath = this.getDefaultProfilePath(baseDirs, browser)

    if (browser === 'firefox') {
      const profilesDir = baseDirs[0]
      const profilePath = profilesDir ? this.findFirefoxProfilePath(profilesDir) : ''
      return profilePath || fallbackPath
    }

    if (browser === 'safari') {
      const safariPath = baseDirs[0]
      if (safariPath && this.isDirectory(safariPath)) {
        return safariPath
      }
      return fallbackPath
    }

    if (baseDirs.length === 0) {
      return fallbackPath
    }

    let detectedPath = ''
    for (const baseDir of baseDirs) {
      if (!baseDir) {
        continue
      }
      const candidates =
        browser === 'opera'
          ? [baseDir, path.join(baseDir, 'Default'), path.join(baseDir, 'Profile 1')]
          : [path.join(baseDir, 'Default'), path.join(baseDir, 'Profile 1')]
      detectedPath = this.pickFirstDirectory(candidates)
      if (detectedPath) {
        break
      }
    }

    return detectedPath || fallbackPath
  }

  @IpcMethod()
  validateBrowserProfilePath(
    _context: IpcContext,
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
    const baseDirs = this.getBrowserProfileBaseDirs(platform, homeDir, browser)
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
}

export { BrowserCookiesService }
