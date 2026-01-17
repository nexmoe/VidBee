import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { DownloadItem, DownloadOptions } from '../../shared/types'
import { scopedLoggers } from '../utils/logger'

export interface DownloadSessionItem {
  id: string
  options: DownloadOptions
  item: DownloadItem
}

interface DownloadSessionPayload {
  version: 1
  updatedAt: number
  items: DownloadSessionItem[]
}

const SESSION_FILE_NAME = 'download-session.json'

const getSessionFilePath = (): string => path.join(app.getPath('userData'), SESSION_FILE_NAME)

const isValidItem = (item: DownloadSessionItem): boolean =>
  Boolean(item?.id && item.options && item.item)

export const loadDownloadSession = (): DownloadSessionItem[] => {
  const filePath = getSessionFilePath()
  if (!fs.existsSync(filePath)) {
    return []
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const payload = JSON.parse(raw) as DownloadSessionPayload
    if (!payload || payload.version !== 1 || !Array.isArray(payload.items)) {
      return []
    }
    return payload.items.filter(isValidItem)
  } catch (error) {
    scopedLoggers.download.warn('Failed to load download session:', error)
    return []
  }
}

export const saveDownloadSession = (items: DownloadSessionItem[]): void => {
  const filePath = getSessionFilePath()
  if (items.length === 0) {
    try {
      fs.rmSync(filePath, { force: true })
    } catch (error) {
      scopedLoggers.download.warn('Failed to clear download session:', error)
    }
    return
  }

  const payload: DownloadSessionPayload = {
    version: 1,
    updatedAt: Date.now(),
    items
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(payload), 'utf-8')
  } catch (error) {
    scopedLoggers.download.warn('Failed to save download session:', error)
  }
}
