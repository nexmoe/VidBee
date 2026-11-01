import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeSubtitleLanguages } from '@vidbee/downloader-core/subtitle-languages'
import { detectSystemProfile } from '@vidbee/i18n/system-locale'
import { parseAsrTier } from '@vidbee/transcription'
import { parseTranscriptionProvider } from '@vidbee/transcription/cloud'
import { parseDownloadMirror } from '@vidbee/transcription/download-mirrors'
import { app } from 'electron'
import { parseAgentPermissionMode } from '../shared/agent-permissions'
import { parseTtsModelId } from '../shared/tts-models'
import type { AppSettings } from '../shared/types'
import { defaultSettings } from '../shared/types'
import { shouldShowWhatsNew, WHATS_NEW_ID } from '../shared/whats-new'
import { resolveStartupDownloadPath } from './lib/download-path-policy'
import { readElectronLocaleHints } from './lib/system-locale'
import {
  getPortableDownloadsPath,
  isPortableMode,
  portableRoot,
  previousPortableRoot,
  rememberPortableRoot
} from './portable'
import { scopedLoggers } from './utils/logger'

// Use require for electron-store to avoid CommonJS/ESM issues
const ElectronStore = require('electron-store')
// Access the default export
const Store = ElectronStore.default || ElectronStore

const OLD_DEFAULT_DOWNLOAD_PATH = path.join(os.homedir(), 'Downloads')
const ensureDirectoryExists = (dir: string) => {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (error) {
    scopedLoggers.system.error('Failed to ensure download directory:', error)
  }
}

const resolveDefaultDownloadPath = () => {
  if (isPortableMode) {
    return getPortableDownloadsPath()
  }

  return path.join(os.homedir(), 'Downloads', 'VidBee')
}

const DEFAULT_DOWNLOAD_PATH = resolveDefaultDownloadPath()
const REQUIRED_AUTO_UPDATE = !isPortableMode
const REQUIRED_LAUNCH_AT_LOGIN = false

/**
 * Resolve the electron-store JSON path used for app settings.
 *
 * @returns Absolute path, or null when Electron userData is unavailable.
 */
const resolveSettingsStorePath = (): string | null => {
  try {
    return path.join(app.getPath('userData'), 'config.json')
  } catch {
    return null
  }
}

class SettingsManager {
  // biome-ignore lint/suspicious/noExplicitAny: electron-store requires dynamic import
  private readonly store: any
  private readonly hadExistingStore: boolean

  constructor() {
    const storePath = resolveSettingsStorePath()
    this.hadExistingStore = Boolean(storePath && fs.existsSync(storePath))
    this.store = new Store({
      cwd: storePath ? path.dirname(storePath) : undefined,
      defaults: {
        ...defaultSettings,
        downloadPath: DEFAULT_DOWNLOAD_PATH,
        autoUpdate: REQUIRED_AUTO_UPDATE,
        launchAtLogin: isPortableMode ? REQUIRED_LAUNCH_AT_LOGIN : defaultSettings.launchAtLogin
      }
    })
    this.ensureDownloadDirectory()
    this.ensureRequiredSettings()
    this.acknowledgeFreshInstallWhatsNew()
    rememberPortableRoot()
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    if (key === 'autoUpdate') {
      return REQUIRED_AUTO_UPDATE as AppSettings[K]
    }

    if (isPortableMode && key === 'launchAtLogin') {
      return REQUIRED_LAUNCH_AT_LOGIN as AppSettings[K]
    }

    if (key === 'asrTier') {
      return parseAsrTier(this.store.get(key)) as AppSettings[K]
    }

    if (key === 'ttsModelId') {
      return parseTtsModelId(this.store.get(key)) as AppSettings[K]
    }

    if (key === 'transcriptionProvider') {
      return parseTranscriptionProvider(this.store.get(key)) as AppSettings[K]
    }

    if (key === 'downloadMirror') {
      return parseDownloadMirror(this.store.get(key)) as AppSettings[K]
    }

    if (key === 'agentManagementTools') {
      return parseAgentPermissionMode(this.store.get(key)) as AppSettings[K]
    }

    return this.store.get(key)
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    if (key === 'autoUpdate') {
      this.store.set(key, REQUIRED_AUTO_UPDATE)
      return
    }

    if (isPortableMode && key === 'launchAtLogin') {
      this.store.set(key, REQUIRED_LAUNCH_AT_LOGIN)
      return
    }

    if (key === 'downloadPath' && typeof value === 'string') {
      ensureDirectoryExists(value)
    }
    this.store.set(key, key === 'agentManagementTools' ? parseAgentPermissionMode(value) : value)
  }

  getAll(): AppSettings {
    return {
      ...defaultSettings,
      downloadPath: DEFAULT_DOWNLOAD_PATH,
      ...this.store.store,
      autoUpdate: REQUIRED_AUTO_UPDATE,
      launchAtLogin: isPortableMode
        ? REQUIRED_LAUNCH_AT_LOGIN
        : (this.store.store.launchAtLogin ?? defaultSettings.launchAtLogin),
      asrTier: parseAsrTier(this.store.store.asrTier),
      ttsModelId: parseTtsModelId(this.store.store.ttsModelId),
      transcriptionProvider: parseTranscriptionProvider(this.store.store.transcriptionProvider),
      agentManagementTools: parseAgentPermissionMode(this.store.store.agentManagementTools),
      downloadMirror: parseDownloadMirror(this.store.store.downloadMirror)
    }
  }

  /**
   * On a first install, persist the UI language from OS language + timezone.
   * Returning users keep the language they already chose.
   */
  applyFreshInstallLocale(): void {
    if (this.hadExistingStore) {
      return
    }
    const profile = detectSystemProfile(readElectronLocaleHints())
    if (this.store.get('language') !== profile.language) {
      this.store.set('language', profile.language)
    }
    scopedLoggers.system.info(
      `Fresh install locale ${profile.language} (china mirrors ${profile.preferChina})`
    )
  }

  setAll(settings: Partial<AppSettings>): void {
    for (const [key, value] of Object.entries(settings)) {
      if (key === 'autoUpdate') {
        this.store.set(key, REQUIRED_AUTO_UPDATE)
        continue
      }

      if (isPortableMode && key === 'launchAtLogin') {
        this.store.set(key, REQUIRED_LAUNCH_AT_LOGIN)
        continue
      }

      if (key === 'downloadPath' && typeof value === 'string') {
        ensureDirectoryExists(value)
      }
      this.store.set(
        key as keyof AppSettings,
        key === 'agentManagementTools' ? parseAgentPermissionMode(value) : value
      )
    }
  }

  reset(): void {
    this.store.clear()
    this.store.set({
      ...defaultSettings,
      downloadPath: DEFAULT_DOWNLOAD_PATH,
      autoUpdate: REQUIRED_AUTO_UPDATE,
      launchAtLogin: isPortableMode ? REQUIRED_LAUNCH_AT_LOGIN : defaultSettings.launchAtLogin
    })
  }

  /**
   * True when this returning user has not dismissed the current What's New card.
   */
  shouldPromptWhatsNew(): boolean {
    return shouldShowWhatsNew({
      isReturningUser: this.hadExistingStore,
      lastSeenWhatsNew: this.get('lastSeenWhatsNew')
    })
  }

  /**
   * Persist that the current What's New card has been shown.
   */
  markWhatsNewSeen(): void {
    this.set('lastSeenWhatsNew', WHATS_NEW_ID)
  }

  /**
   * Stamp a fresh install so the first-run user is not treated as an updater later.
   */
  private acknowledgeFreshInstallWhatsNew(): void {
    if (!this.shouldPromptWhatsNew()) {
      this.markWhatsNewSeen()
    }
  }

  private ensureDownloadDirectory(): void {
    try {
      const currentPath: string | undefined = this.store.get('downloadPath')
      const normalizedDownloadPath = resolveStartupDownloadPath({
        currentPath,
        defaultPath: DEFAULT_DOWNLOAD_PATH,
        oldDefaultPath: OLD_DEFAULT_DOWNLOAD_PATH,
        portableMode: isPortableMode,
        portableRoot,
        previousPortableRoot
      })

      if (normalizedDownloadPath !== currentPath) {
        this.store.set('downloadPath', normalizedDownloadPath)
      }
      ensureDirectoryExists(normalizedDownloadPath)
    } catch (error) {
      scopedLoggers.system.error('Failed to verify download directory:', error)
    }
  }

  private ensureRequiredSettings(): void {
    try {
      const storedPermissionMode = this.store.get('agentManagementTools')
      const permissionMode = parseAgentPermissionMode(storedPermissionMode)
      if (storedPermissionMode !== permissionMode) {
        this.store.set('agentManagementTools', permissionMode)
      }
      if (this.store.get('autoUpdate') !== REQUIRED_AUTO_UPDATE) {
        this.store.set('autoUpdate', REQUIRED_AUTO_UPDATE)
      }
      if (isPortableMode && this.store.get('launchAtLogin') !== REQUIRED_LAUNCH_AT_LOGIN) {
        this.store.set('launchAtLogin', REQUIRED_LAUNCH_AT_LOGIN)
      }
      const storedTier = this.store.get('asrTier')
      const parsedTier = parseAsrTier(storedTier)
      if (storedTier !== parsedTier) {
        this.store.set('asrTier', parsedTier)
      }
      const storedSubtitleLanguages = this.store.get('subtitleLanguages')
      const parsedSubtitleLanguages = normalizeSubtitleLanguages(
        Array.isArray(storedSubtitleLanguages)
          ? storedSubtitleLanguages.filter(
              (language): language is string => typeof language === 'string'
            )
          : undefined
      )
      if (
        !Array.isArray(storedSubtitleLanguages) ||
        storedSubtitleLanguages.length !== parsedSubtitleLanguages.length ||
        storedSubtitleLanguages.some(
          (language, index) => language !== parsedSubtitleLanguages[index]
        )
      ) {
        this.store.set('subtitleLanguages', parsedSubtitleLanguages)
      }
    } catch (error) {
      scopedLoggers.system.error('Failed to enforce required settings:', error)
    }
  }
}

export const settingsManager = new SettingsManager()
