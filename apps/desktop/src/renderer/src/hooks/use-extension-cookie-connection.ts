import type { ExtensionCookieConnection } from '@shared/extension-cookies'
import { useEffect, useRef, useState } from 'react'
import { ipcServices } from '../lib/ipc'
import { logger } from '../lib/logger'

/**
 * Compare the fields the settings page and home banner render.
 * @param current Connection already shown.
 * @param next Connection returned by the latest poll.
 * @returns True when connected, browser, last seen, and sites match.
 */
function sameExtensionCookieConnection(
  current: ExtensionCookieConnection,
  next: ExtensionCookieConnection
): boolean {
  return (
    current.connected === next.connected &&
    current.browser === next.browser &&
    current.lastSeenAt === next.lastSeenAt &&
    JSON.stringify(current.sites) === JSON.stringify(next.sites)
  )
}

/**
 * Track the live cookie bridge for the home page and cookie settings.
 * @param onConnectionChange Refresh dependent state when the bridge connects or disconnects.
 */
export function useExtensionCookieConnection(
  onConnectionChange?: () => void
): ExtensionCookieConnection {
  const [connection, setConnection] = useState<ExtensionCookieConnection>({
    connected: false,
    sites: []
  })
  const connectionRef = useRef(connection)

  useEffect(() => {
    let active = true
    let previousConnected: boolean | undefined

    /** Read the bridge status while this consumer remains mounted. */
    const tick = async (): Promise<void> => {
      try {
        const next = await ipcServices.browserCookies.getExtensionConnection()
        if (!active) {
          return
        }
        if (!sameExtensionCookieConnection(connectionRef.current, next)) {
          connectionRef.current = next
          setConnection(next)
        }
        if (previousConnected !== undefined && previousConnected !== next.connected) {
          onConnectionChange?.()
        }
        previousConnected = next.connected
      } catch (error) {
        logger.error('[Cookies] Failed to read extension connection:', error)
      }
    }

    void tick()
    const timer = window.setInterval(() => void tick(), 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [onConnectionChange])

  return connection
}
