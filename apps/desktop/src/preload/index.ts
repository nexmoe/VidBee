import { setupRenderer } from '@better-auth/electron/preload'
import { electronAPI } from '@electron-toolkit/preload'
import { logger } from '@vidbee/logger/client'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { createIpcProxy } from 'electron-ipc-decorator/client'
import type { IpcServices } from '../main/ipc'

// Create type-safe IPC proxy using electron-ipc-decorator
const ipcServices = createIpcProxy<IpcServices>(ipcRenderer)

setupRenderer({ channelPrefix: 'vidbee-auth' })

// Custom APIs for renderer
const api = {
  // IPC Services (type-safe, using decorators)
  ...ipcServices,

  // Event listening API
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      callback(...args)
    ipcRenderer.on(channel, subscription)
    return subscription
  },
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, callback)
  },
  // Send message to main process
  send: (channel: string, ...args: unknown[]) => {
    ipcRenderer.send(channel, ...args)
  },
  /**
   * Resolve a dropped or pasted File to a local filesystem path.
   */
  getPathForFile: (file: File): string | null => {
    try {
      const filePath = webUtils.getPathForFile(file)
      return filePath?.trim() ? filePath : null
    } catch {
      return null
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    logger.error('Failed to expose APIs in context bridge:', error)
  }
} else {
  // @ts-expect-error (define in dts)
  window.electron = electronAPI
  // @ts-expect-error (define in dts)
  window.api = api
}
