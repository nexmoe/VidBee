import type { ElectronAPI } from '@electron-toolkit/preload'
import type { IpcServices } from '../main/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    api: IpcServices & {
      on: (channel: string, callback: (...args: unknown[]) => void) => void
      removeListener: (channel: string, callback: (...args: unknown[]) => void) => void
      send: (channel: string, ...args: unknown[]) => void
    }
  }
}
