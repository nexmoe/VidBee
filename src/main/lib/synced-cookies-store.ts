import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type { SyncedCookie, SyncedCookiesSnapshot } from '../../shared/types'
import { scopedLoggers } from '../utils/logger'

type EncryptionMethod = 'safeStorage' | 'aes-256-gcm'

interface PersistedCookiesEntry {
  id: string
  createdAt: number
  host: string
  url: string
  title?: string
  cookieCount: number
  encryptedCookies: string
  encryption: EncryptionMethod
}

interface PersistedCookiesSnapshot {
  createdAt: number
  cookieCount: number
  encryptedCookies: string
  encryption: EncryptionMethod
}

interface PersistedCookiesPayloadV1 {
  version: 1
  updatedAt: number
  entries: PersistedCookiesEntry[]
}

interface PersistedCookiesPayloadV2 {
  version: 2
  updatedAt: number
  snapshot?: PersistedCookiesSnapshot
}

type PersistedCookiesPayload = PersistedCookiesPayloadV1 | PersistedCookiesPayloadV2

const STORAGE_VERSION = 2
const COOKIES_FILE_NAME = 'synced-cookies.json'
const FALLBACK_KEY_FILE_NAME = 'synced-cookies.key'
const FALLBACK_IV_LENGTH = 12
const FALLBACK_TAG_LENGTH = 16

const getCookiesFilePath = (): string => path.join(app.getPath('userData'), COOKIES_FILE_NAME)

const getFallbackKeyPath = (): string => path.join(app.getPath('userData'), FALLBACK_KEY_FILE_NAME)

const loadFallbackKey = (): Buffer => {
  const keyPath = getFallbackKeyPath()
  try {
    if (fs.existsSync(keyPath)) {
      const stored = fs.readFileSync(keyPath, 'utf-8')
      const key = Buffer.from(stored, 'base64')
      if (key.length === 32) {
        return key
      }
    }
  } catch (error) {
    scopedLoggers.system.warn('Failed to read cookie encryption key:', error)
  }

  const key = crypto.randomBytes(32)
  try {
    fs.writeFileSync(keyPath, key.toString('base64'), { mode: 0o600 })
  } catch (error) {
    scopedLoggers.system.warn('Failed to store cookie encryption key:', error)
  }
  return key
}

const encryptPayload = (text: string): { encrypted: string; method: EncryptionMethod } => {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(text).toString('base64')
    return { encrypted, method: 'safeStorage' }
  }

  const key = loadFallbackKey()
  const iv = crypto.randomBytes(FALLBACK_IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const payload = Buffer.concat([iv, tag, encrypted]).toString('base64')
  return { encrypted: payload, method: 'aes-256-gcm' }
}

const decryptPayload = (payload: string, method: EncryptionMethod): string => {
  if (method === 'safeStorage') {
    return safeStorage.decryptString(Buffer.from(payload, 'base64'))
  }

  const key = loadFallbackKey()
  const buffer = Buffer.from(payload, 'base64')
  const iv = buffer.subarray(0, FALLBACK_IV_LENGTH)
  const tag = buffer.subarray(FALLBACK_IV_LENGTH, FALLBACK_IV_LENGTH + FALLBACK_TAG_LENGTH)
  const encrypted = buffer.subarray(FALLBACK_IV_LENGTH + FALLBACK_TAG_LENGTH)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return decrypted.toString('utf8')
}

const loadPersistedSnapshot = (): PersistedCookiesSnapshot | null => {
  const filePath = getCookiesFilePath()
  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const payload = JSON.parse(raw) as PersistedCookiesPayload
    if (!payload) return null

    if (payload.version === 2) {
      return payload.snapshot ?? null
    }

    if (payload.version === 1 && Array.isArray(payload.entries)) {
      const latest = payload.entries.reduce<PersistedCookiesEntry | null>((acc, entry) => {
        if (!acc || entry.createdAt > acc.createdAt) return entry
        return acc
      }, null)
      if (!latest) return null
      return {
        createdAt: latest.createdAt,
        cookieCount: latest.cookieCount,
        encryptedCookies: latest.encryptedCookies,
        encryption: latest.encryption
      }
    }

    return null
  } catch (error) {
    scopedLoggers.system.warn('Failed to load synced cookies:', error)
    return null
  }
}

const savePersistedSnapshot = (snapshot: PersistedCookiesSnapshot): void => {
  const filePath = getCookiesFilePath()
  const payload: PersistedCookiesPayloadV2 = {
    version: STORAGE_VERSION,
    updatedAt: Date.now(),
    snapshot
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(payload), 'utf-8')
  } catch (error) {
    scopedLoggers.system.warn('Failed to store synced cookies:', error)
  }
}

const mapCookies = (cookies: SyncedCookie[]): SyncedCookie[] => {
  return cookies.map((cookie) => ({
    domain: cookie.domain ?? '',
    name: cookie.name ?? '',
    value: cookie.value ?? '',
    path: cookie.path ?? '/',
    secure: cookie.secure ?? false,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: cookie.expirationDate
  }))
}

export const addSyncedCookies = (input: { cookies: SyncedCookie[] }): SyncedCookiesSnapshot => {
  const cookies = mapCookies(input.cookies)
  const cookieCount = cookies.length
  const { encrypted, method } = encryptPayload(JSON.stringify(cookies))

  const snapshot: PersistedCookiesSnapshot = {
    createdAt: Date.now(),
    cookieCount,
    encryptedCookies: encrypted,
    encryption: method
  }

  savePersistedSnapshot(snapshot)

  return {
    createdAt: snapshot.createdAt,
    cookieCount: snapshot.cookieCount,
    cookies
  }
}

export const listSyncedCookies = (): SyncedCookiesSnapshot[] => {
  const snapshot = loadPersistedSnapshot()
  if (!snapshot) return []

  try {
    const decrypted = decryptPayload(snapshot.encryptedCookies, snapshot.encryption)
    const cookies = (JSON.parse(decrypted) as SyncedCookie[]) ?? []
    return [
      {
        createdAt: snapshot.createdAt,
        cookieCount: snapshot.cookieCount,
        cookies
      }
    ]
  } catch (error) {
    scopedLoggers.system.warn('Failed to decrypt synced cookies snapshot:', error)
    return []
  }
}

const convertToNetscapeFormat = (cookies: SyncedCookie[]): string => {
  const lines: string[] = ['# Netscape HTTP Cookie File', '# This file was generated by VidBee', '']

  for (const cookie of cookies) {
    // Netscape format: domain flag path secure expiration name value
    const domain = cookie.domain || ''
    // Flag: TRUE if domain starts with '.', FALSE otherwise
    const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE'
    const path = cookie.path || '/'
    const secure = cookie.secure ? 'TRUE' : 'FALSE'
    // Convert expirationDate to Unix timestamp (seconds)
    // If no expiration, use 0 (session cookie) or a far future date
    const expiration = cookie.expirationDate ? Math.floor(cookie.expirationDate) : 0
    const name = cookie.name || ''
    const value = cookie.value || ''

    // Tab-separated values
    lines.push(`${domain}\t${flag}\t${path}\t${secure}\t${expiration}\t${name}\t${value}`)
  }

  return lines.join('\n')
}

const TEMP_COOKIES_FILE = 'synced-cookies-temp.txt'

const getTempCookiesFilePath = (): string =>
  path.join(app.getPath('userData'), TEMP_COOKIES_FILE)

export const exportCookiesToTempFile = (): string | null => {
  const snapshots = listSyncedCookies()
  if (snapshots.length === 0 || !snapshots[0]) {
    return null
  }

  const cookies = snapshots[0].cookies
  if (!cookies || cookies.length === 0) {
    return null
  }

  const netscapeContent = convertToNetscapeFormat(cookies)
  const tempFilePath = getTempCookiesFilePath()

  try {
    fs.writeFileSync(tempFilePath, netscapeContent, 'utf-8')
    scopedLoggers.system.info('Exported cookies to temp file:', tempFilePath)
    return tempFilePath
  } catch (error) {
    scopedLoggers.system.warn('Failed to export cookies to temp file:', error)
    return null
  }
}

export const cleanupTempCookiesFile = (): void => {
  const tempFilePath = getTempCookiesFilePath()
  try {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath)
      scopedLoggers.system.info('Cleaned up temp cookies file')
    }
  } catch (error) {
    scopedLoggers.system.warn('Failed to cleanup temp cookies file:', error)
  }
}
