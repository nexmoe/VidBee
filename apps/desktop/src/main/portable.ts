import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export const portableRoot =
  process.env.PORTABLE_EXECUTABLE_DIR || process.env.VIDBEE_PORTABLE_DIR || ''

export const isPortableMode = portableRoot.length > 0

const ensureDirectoryExists = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true })
}

const setEnvPath = (key: string, value: string): void => {
  process.env[key] = value
}

const setAppPath = (name: Parameters<typeof app.setPath>[0], value: string): void => {
  try {
    app.setPath(name, value)
  } catch {
    // Some Electron path names can be platform-specific.
  }
}

export const getPortablePath = (...segments: string[]): string => {
  return path.join(portableRoot, ...segments)
}

export const getPortableDownloadsPath = (): string => {
  return getPortablePath('Downloads')
}

export const configurePortableMode = (): void => {
  if (!isPortableMode) {
    return
  }

  const roamingDir = getPortablePath('Data', 'Roaming')
  const localDir = getPortablePath('Data', 'Local')
  const userDataDir = getPortablePath('Data', 'UserData')
  const sessionDataDir = getPortablePath('Data', 'SessionData')
  const homeDir = getPortablePath('Data', 'Home')
  const cacheDir = getPortablePath('Data', 'Cache')
  const configDir = getPortablePath('Data', 'Config')
  const localShareDir = getPortablePath('Data', 'LocalShare')
  const denoDir = getPortablePath('Data', 'Deno')
  const logsDir = getPortablePath('Data', 'Logs')
  const crashDumpsDir = getPortablePath('Data', 'CrashDumps')
  const downloadsDir = getPortableDownloadsPath()
  const tempDir = getPortablePath('Temp')

  for (const dir of [
    roamingDir,
    localDir,
    userDataDir,
    sessionDataDir,
    homeDir,
    cacheDir,
    configDir,
    localShareDir,
    denoDir,
    logsDir,
    crashDumpsDir,
    downloadsDir,
    tempDir
  ]) {
    ensureDirectoryExists(dir)
  }

  setEnvPath('APPDATA', roamingDir)
  setEnvPath('LOCALAPPDATA', localDir)
  setEnvPath('USERPROFILE', homeDir)
  setEnvPath('HOME', homeDir)
  setEnvPath('XDG_CACHE_HOME', cacheDir)
  setEnvPath('XDG_CONFIG_HOME', configDir)
  setEnvPath('XDG_DATA_HOME', localShareDir)
  setEnvPath('DENO_DIR', denoDir)
  setEnvPath('TEMP', tempDir)
  setEnvPath('TMP', tempDir)
  setEnvPath('VIDBEE_PORTABLE', '1')

  setAppPath('appData', roamingDir)
  setAppPath('userData', userDataDir)
  setAppPath('sessionData', sessionDataDir)
  setAppPath('temp', tempDir)
  setAppPath('downloads', downloadsDir)
  setAppPath('logs', logsDir)
  setAppPath('crashDumps', crashDumpsDir)
}

configurePortableMode()
