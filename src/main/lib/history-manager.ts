// Use require for electron-store to avoid CommonJS/ESM issues
const ElectronStore = require('electron-store')
// Access the default export
const Store = ElectronStore.default || ElectronStore

import type { DownloadHistoryItem } from '../../shared/types'

class HistoryManager {
  // biome-ignore lint/suspicious/noExplicitAny: electron-store requires dynamic import
  private store: any
  private history: Map<string, DownloadHistoryItem> = new Map()

  constructor() {
    this.store = new Store({
      name: 'download-history',
      defaults: {
        items: []
      }
    })
    this.loadHistory()
  }

  private loadHistory(): void {
    try {
      const historyArray = this.store.get('items', [])
      this.history = new Map(historyArray.map((item) => [item.id, item]))
    } catch (error) {
      console.error('Failed to load download history:', error)
    }
  }

  private saveHistory(): void {
    try {
      const historyArray = Array.from(this.history.values())
      this.store.set('items', historyArray)
    } catch (error) {
      console.error('Failed to save download history:', error)
    }
  }

  addHistoryItem(item: DownloadHistoryItem): void {
    this.history.set(item.id, item)
    this.saveHistory()
  }

  getHistory(): DownloadHistoryItem[] {
    return Array.from(this.history.values()).sort((a, b) => {
      const aTime = a.completedAt || a.downloadedAt
      const bTime = b.completedAt || b.downloadedAt
      return bTime - aTime
    })
  }

  getHistoryById(id: string): DownloadHistoryItem | undefined {
    return this.history.get(id)
  }

  removeHistoryItem(id: string): boolean {
    const deleted = this.history.delete(id)
    if (deleted) {
      this.saveHistory()
    }
    return deleted
  }

  clearHistory(): void {
    this.history.clear()
    this.saveHistory()
  }

  clearHistoryByStatus(status: DownloadHistoryItem['status']): number {
    let removedCount = 0
    for (const [id, item] of this.history.entries()) {
      if (item.status === status) {
        this.history.delete(id)
        removedCount++
      }
    }
    if (removedCount > 0) {
      this.saveHistory()
    }
    return removedCount
  }

  getHistoryCount(): {
    active: number
    completed: number
    error: number
    cancelled: number
    total: number
  } {
    const counts = {
      active: 0,
      completed: 0,
      error: 0,
      cancelled: 0,
      total: this.history.size
    }

    for (const item of this.history.values()) {
      if (item.status === 'completed') {
        counts.completed++
      } else if (item.status === 'error') {
        counts.error++
      } else if (item.status === 'cancelled') {
        counts.cancelled++
      } else {
        counts.active++
      }
    }

    return counts
  }
}

export const historyManager = new HistoryManager()
