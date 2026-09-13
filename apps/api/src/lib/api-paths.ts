/**
 * Filesystem layout for the self-hosted API.
 *
 *   VIDBEE_DOWNLOAD_DIR  – media output (Docker: /data/downloads)
 *   VIDBEE_DATA_DIR      – settings, sqlite, models (default: $VIDBEE_DOWNLOAD_DIR/.vidbee)
 *
 * Keeping data next to downloads means the default Docker downloads volume
 * already persists queues and settings. Set VIDBEE_DATA_DIR=/data/vidbee to
 * split the database onto the dedicated data volume.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_DOWNLOAD_DIR_FALLBACK = path.join(os.homedir(), 'Downloads', 'VidBee')

export const trimEnvValue = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

export const trimEnv = (name: string): string | undefined => trimEnvValue(process.env[name])

export interface ApiPaths {
  dataDir: string
  dbFile: string
  downloadDir: string
  settingsFile: string
  settingsFilesDir: string
}

/**
 * Resolve download and data directories from environment values.
 *
 * @param env Process environment, usually `process.env`.
 * @returns Absolute layout used by the API host.
 */
export const resolveApiPaths = (
  env: Record<string, string | undefined> = process.env,
  pathExists: (candidate: string) => boolean = (candidate) => fs.existsSync(candidate)
): ApiPaths => {
  const downloadDir =
    trimEnvValue(env.VIDBEE_DOWNLOAD_DIR) ??
    trimEnvValue(env.DOWNLOAD_DIR) ??
    DEFAULT_DOWNLOAD_DIR_FALLBACK
  const requestedDataDir = trimEnvValue(env.VIDBEE_DATA_DIR)
  const defaultDataDir = path.join(downloadDir, '.vidbee')
  const legacyDb = path.join(defaultDataDir, 'vidbee.db')
  const requestedDb = requestedDataDir ? path.join(requestedDataDir, 'vidbee.db') : null
  const dataDir =
    requestedDataDir &&
    requestedDataDir !== defaultDataDir &&
    requestedDb &&
    !pathExists(requestedDb) &&
    pathExists(legacyDb)
      ? defaultDataDir
      : (requestedDataDir ?? defaultDataDir)
  return {
    dataDir,
    dbFile: path.join(dataDir, 'vidbee.db'),
    downloadDir,
    settingsFile: path.join(dataDir, 'web-settings.json'),
    settingsFilesDir: path.join(dataDir, 'settings-files')
  }
}

const resolved = resolveApiPaths()

export const apiDefaultDownloadDir = resolved.downloadDir

export const apiDataDir = resolved.dataDir

export const apiSettingsFile = resolved.settingsFile

export const apiSettingsFilesDir = resolved.settingsFilesDir

export const apiDbFile = resolved.dbFile

/**
 * Return whether targetPath is the base directory or a file/dir inside it.
 *
 * @param basePath Allowed root.
 * @param targetPath Candidate path.
 * @returns True when the candidate cannot escape the root.
 */
export const isPathInside = (basePath: string, targetPath: string): boolean => {
  const normalizedBase = path.resolve(basePath)
  const normalizedTarget = path.resolve(targetPath)
  const relativePath = path.relative(normalizedBase, normalizedTarget)
  if (relativePath === '') {
    return true
  }
  return !(relativePath.startsWith('..') || path.isAbsolute(relativePath))
}

fs.mkdirSync(apiDefaultDownloadDir, { recursive: true })
fs.mkdirSync(apiDataDir, { recursive: true })
