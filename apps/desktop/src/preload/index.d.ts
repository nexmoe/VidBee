import type { ElectronAPI } from '@electron-toolkit/preload'
import type { IpcServices } from '../main/ipc'
import type { authClient } from '../main/lib/auth-client'

type DesktopAuthBridges = (typeof authClient)['$Infer']['Bridges']

declare global {
  interface Window {
    authenticate: DesktopAuthBridges['authenticate']
    electron: ElectronAPI
    getUser: DesktopAuthBridges['getUser']
    onAuthenticated: DesktopAuthBridges['onAuthenticated']
    onAuthError: DesktopAuthBridges['onAuthError']
    onUserUpdated: DesktopAuthBridges['onUserUpdated']
    requestAuth: DesktopAuthBridges['requestAuth']
    signOut: DesktopAuthBridges['signOut']
    api: IpcServices & {
      on: (channel: string, callback: (...args: unknown[]) => void) => (...args: unknown[]) => void
      removeListener: (channel: string, callback: (...args: unknown[]) => void) => void
      send: (channel: string, ...args: unknown[]) => void
      getPathForFile: (file: File) => string | null
    }
  }
}
