import path from 'node:path'

/**
 * Path helper that matches the target OS even when tests run elsewhere.
 *
 * @param platform Node `os.platform()` value.
 */
const pathForPlatform = (platform: string): path.PlatformPath =>
  platform === 'win32' ? path.win32 : path.posix

/**
 * Default profile root directories for a browser on this OS.
 *
 * @param platform Node `os.platform()` value.
 * @param homeDir User home directory.
 * @param browser Browser id.
 */
export const getBrowserProfileBaseDirs = (
  platform: string,
  homeDir: string,
  browser: string
): string[] => {
  const join = pathForPlatform(platform).join
  if (platform === 'win32') {
    if (browser === 'edge') {
      return [join(homeDir, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data')]
    }
    if (browser === 'chrome') {
      return [join(homeDir, 'AppData', 'Local', 'Google', 'Chrome', 'User Data')]
    }
    if (browser === 'chromium') {
      return [join(homeDir, 'AppData', 'Local', 'Chromium', 'User Data')]
    }
    if (browser === 'brave') {
      return [join(homeDir, 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data')]
    }
    if (browser === 'vivaldi') {
      return [join(homeDir, 'AppData', 'Local', 'Vivaldi', 'User Data')]
    }
    if (browser === 'whale') {
      return [join(homeDir, 'AppData', 'Local', 'Naver', 'Whale', 'User Data')]
    }
    if (browser === 'opera') {
      return [join(homeDir, 'AppData', 'Roaming', 'Opera Software', 'Opera Stable')]
    }
    if (browser === 'firefox') {
      return [join(homeDir, 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles')]
    }
  }

  if (platform === 'darwin') {
    if (browser === 'edge') {
      return [join(homeDir, 'Library', 'Application Support', 'Microsoft Edge')]
    }
    if (browser === 'chrome') {
      return [join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome')]
    }
    if (browser === 'chromium') {
      return [join(homeDir, 'Library', 'Application Support', 'Chromium')]
    }
    if (browser === 'brave') {
      return [join(homeDir, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')]
    }
    if (browser === 'vivaldi') {
      return [join(homeDir, 'Library', 'Application Support', 'Vivaldi')]
    }
    if (browser === 'whale') {
      return [
        join(homeDir, 'Library', 'Application Support', 'Whale'),
        join(homeDir, 'Library', 'Application Support', 'Naver Whale')
      ]
    }
    if (browser === 'opera') {
      return [
        join(homeDir, 'Library', 'Application Support', 'com.operasoftware.Opera'),
        join(homeDir, 'Library', 'Application Support', 'Opera Software', 'Opera Stable')
      ]
    }
    if (browser === 'firefox') {
      return [join(homeDir, 'Library', 'Application Support', 'Firefox', 'Profiles')]
    }
    if (browser === 'safari') {
      return [join(homeDir, 'Library', 'Safari')]
    }
  }

  if (platform === 'linux') {
    if (browser === 'edge') {
      return [join(homeDir, '.config', 'microsoft-edge')]
    }
    if (browser === 'chrome') {
      return [join(homeDir, '.config', 'google-chrome')]
    }
    if (browser === 'chromium') {
      return [join(homeDir, '.config', 'chromium')]
    }
    if (browser === 'brave') {
      return [
        join(homeDir, '.config', 'BraveSoftware', 'Brave-Browser'),
        join(homeDir, '.config', 'BraveSoftware', 'Brave-Origin')
      ]
    }
    if (browser === 'vivaldi') {
      return [join(homeDir, '.config', 'vivaldi')]
    }
    if (browser === 'whale') {
      return [join(homeDir, '.config', 'naver-whale')]
    }
    if (browser === 'opera') {
      return [join(homeDir, '.config', 'opera')]
    }
    if (browser === 'firefox') {
      return [join(homeDir, '.mozilla', 'firefox')]
    }
  }

  if (platform === 'freebsd' && browser === 'firefox') {
    return [join(homeDir, '.mozilla', 'firefox')]
  }

  return []
}

/**
 * Candidate profile folders to probe for a browser.
 *
 * @param platform Node `os.platform()` value.
 * @param homeDir User home directory.
 * @param browser Browser id.
 */
export const getBrowserProfileCandidates = (
  platform: string,
  homeDir: string,
  browser: string
): string[] => {
  const join = pathForPlatform(platform).join
  const baseDirs = getBrowserProfileBaseDirs(platform, homeDir, browser)
  if (browser === 'firefox' || browser === 'safari') {
    return baseDirs
  }

  const candidates: string[] = []
  for (const baseDir of baseDirs) {
    if (browser === 'opera') {
      candidates.push(baseDir, join(baseDir, 'Default'), join(baseDir, 'Profile 1'))
      continue
    }
    candidates.push(join(baseDir, 'Default'), join(baseDir, 'Profile 1'))
  }
  return candidates
}

/**
 * Cookie database filename expected inside a browser profile.
 *
 * @param browser Browser id.
 */
export const getBrowserCookieDatabaseName = (browser: string): string => {
  if (browser === 'firefox') {
    return 'cookies.sqlite'
  }
  if (browser === 'safari') {
    return 'Cookies.binarycookies'
  }
  return 'Cookies'
}

/**
 * Relative path segments for cookie databases inside a browser profile.
 * Chromium 96+ may keep cookies at `Network/Cookies` instead of `Cookies`.
 *
 * @param browser Browser id.
 */
export const getBrowserCookieDatabaseRelativeSegments = (browser: string): string[][] => {
  if (browser === 'firefox') {
    return [['cookies.sqlite']]
  }
  if (browser === 'safari') {
    return [['Cookies.binarycookies']]
  }
  return [['Cookies'], ['Network', 'Cookies']]
}
