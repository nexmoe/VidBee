/**
 * IPC Services for Renderer Process
 *
 * This file provides a convenient way to access IPC services in the renderer process.
 * All services are type-safe and automatically generated from the main process.
 *
 * Usage:
 * import { ipcServices, ipcEvents } from '@renderer/lib/ipc'
 *
 * const version = await ipcServices.app.getAppVersion()
 * const info = await ipcServices.app.getAppInfo()
 * await ipcServices.app.switchAppLocale('zh-CN')
 *
 * // Event listening
 * const unsubscribe = ipcEvents.on('download:started', (id: string) => {
 *   console.log('Download started:', id)
 * })
 * ipcEvents.removeListener('download:started', unsubscribe)
 */

import type { IpcServices } from '@shared/types/ipc'

import { createIpcProxy } from 'electron-ipc-decorator/client'

// ipcRenderer should be exposed through electron's context bridge
// Create type-safe IPC proxy for renderer process
export const ipcServices = createIpcProxy<IpcServices>(
  window.electron.ipcRenderer as unknown as Electron.IpcRenderer
) as NonNullable<ReturnType<typeof createIpcProxy<IpcServices>>>

// Export event listening utilities
export const ipcEvents = {
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    return window.api.on(channel, callback)
  },
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => {
    window.api.removeListener(channel, callback)
  },
  send: (channel: string, ...args: unknown[]) => {
    window.api.send(channel, ...args)
  }
}

// Export types for use in other files
export type { IpcServices }
