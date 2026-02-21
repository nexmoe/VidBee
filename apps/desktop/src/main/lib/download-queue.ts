import { EventEmitter } from 'node:events'
import type { DownloadItem, DownloadOptions } from '../../shared/types'

interface QueueItem {
  id: string
  options: DownloadOptions
  item: DownloadItem
}

export class DownloadQueue extends EventEmitter {
  private queue: QueueItem[] = []
  private readonly activeDownloads: Map<string, QueueItem> = new Map()
  private readonly completedDownloads: Map<string, QueueItem> = new Map()
  private maxConcurrent: number

  constructor(maxConcurrent = 5) {
    super()
    this.maxConcurrent = maxConcurrent
  }

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = max
    this.processQueue()
  }

  add(id: string, options: DownloadOptions, item: DownloadItem): void {
    this.queue.push({ id, options, item })
    this.emit('queue-updated', this.getQueueStatus())
    this.processQueue()
  }

  remove(id: string): boolean {
    // Remove from queue
    const queueIndex = this.queue.findIndex((item) => item.id === id)
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1)
      this.emit('queue-updated', this.getQueueStatus())
      return true
    }

    // Remove from active downloads
    if (this.activeDownloads.has(id)) {
      this.activeDownloads.delete(id)
      this.emit('queue-updated', this.getQueueStatus())
      this.processQueue()
      return true
    }

    return false
  }

  downloadCompleted(id: string): void {
    const activeDownload = this.activeDownloads.get(id)
    if (activeDownload) {
      this.completedDownloads.set(id, activeDownload)
      this.activeDownloads.delete(id)
    }
    this.emit('queue-updated', this.getQueueStatus())
    this.processQueue()
  }

  private processQueue(): void {
    while (this.activeDownloads.size < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()
      if (item) {
        this.activeDownloads.set(item.id, item)
        this.emit('start-download', item)
      }
    }
    this.emit('queue-updated', this.getQueueStatus())
  }

  getQueueStatus(): {
    queued: number
    active: number
    activeIds: string[]
  } {
    return {
      queued: this.queue.length,
      active: this.activeDownloads.size,
      activeIds: Array.from(this.activeDownloads.keys())
    }
  }

  getActiveItems(): DownloadItem[] {
    return Array.from(this.activeDownloads.values()).map((item) => ({ ...item.item }))
  }

  getQueuedItems(): DownloadItem[] {
    return this.queue.map((item) => ({ ...item.item }))
  }

  getActiveEntries(): Array<{ options: DownloadOptions; item: DownloadItem }> {
    return Array.from(this.activeDownloads.values()).map((entry) => ({
      options: { ...entry.options },
      item: { ...entry.item }
    }))
  }

  getQueuedEntries(): Array<{ options: DownloadOptions; item: DownloadItem }> {
    return this.queue.map((entry) => ({
      options: { ...entry.options },
      item: { ...entry.item }
    }))
  }

  isDownloading(id: string): boolean {
    return this.activeDownloads.has(id)
  }

  getCompletedDownload(id: string): QueueItem | undefined {
    return this.completedDownloads.get(id)
  }

  getItemDetails(id: string): { options: DownloadOptions; item: DownloadItem } | undefined {
    const inActive = this.activeDownloads.get(id)
    if (inActive) {
      return {
        options: inActive.options,
        item: { ...inActive.item }
      }
    }

    const inQueue = this.queue.find((entry) => entry.id === id)
    if (inQueue) {
      return {
        options: inQueue.options,
        item: { ...inQueue.item }
      }
    }

    const completed = this.completedDownloads.get(id)
    if (completed) {
      return {
        options: completed.options,
        item: { ...completed.item }
      }
    }

    return undefined
  }

  updateItemInfo(id: string, updates: Partial<DownloadItem>): void {
    // Update in queue
    const queueItem = this.queue.find((item) => item.id === id)
    if (queueItem) {
      Object.assign(queueItem.item, updates)
    }

    // Update in active downloads
    const activeItem = this.activeDownloads.get(id)
    if (activeItem) {
      Object.assign(activeItem.item, updates)
    }

    // Update in completed downloads
    const completedItem = this.completedDownloads.get(id)
    if (completedItem) {
      Object.assign(completedItem.item, updates)
    }
  }

  clear(): void {
    this.queue = []
    this.emit('queue-updated', this.getQueueStatus())
  }
}
