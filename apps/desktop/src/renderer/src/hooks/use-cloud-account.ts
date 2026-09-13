import { ipcEvents, ipcServices } from '@renderer/lib/ipc'
import type { DesktopAiCreditUsage, DesktopAuthUser } from '@shared/types/auth'
import { useCallback, useEffect, useState } from 'react'

interface CloudAccountState {
  credits: DesktopAiCreditUsage | null
  loading: boolean
  user: DesktopAuthUser | null
}

/** Keep the renderer's sanitized Cloud user and AI credit balance in sync. */
export function useCloudAccount(enabled = true): CloudAccountState {
  const [user, setUser] = useState<DesktopAuthUser | null>(null)
  const [credits, setCredits] = useState<DesktopAiCreditUsage | null>(null)
  const [loading, setLoading] = useState(enabled)

  /** Refresh the balance for an authenticated user without exposing session data. */
  const loadCredits = useCallback(async (nextUser: DesktopAuthUser | null): Promise<void> => {
    if (!nextUser) {
      setCredits(null)
      return
    }
    try {
      setCredits(await ipcServices.account.getAiCredits())
    } catch {
      setCredits(null)
    }
  }, [])

  useEffect(() => {
    if (!enabled || typeof window.getUser !== 'function') {
      setLoading(false)
      return
    }
    let active = true
    void window
      .getUser()
      .then(async (nextUser) => {
        if (!active) {
          return
        }
        const sanitizedUser = nextUser as DesktopAuthUser | null
        setUser(sanitizedUser)
        await loadCredits(sanitizedUser)
      })
      .catch(() => {
        if (active) {
          setUser(null)
          setCredits(null)
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    const removeAuthenticated =
      typeof window.onAuthenticated === 'function'
        ? window.onAuthenticated((nextUser) => {
            const sanitizedUser = nextUser as DesktopAuthUser
            setUser(sanitizedUser)
            setLoading(false)
            void loadCredits(sanitizedUser)
          })
        : undefined
    const removeUpdated =
      typeof window.onUserUpdated === 'function'
        ? window.onUserUpdated((nextUser) => {
            const sanitizedUser = nextUser as DesktopAuthUser | null
            setUser(sanitizedUser)
            setLoading(false)
            void loadCredits(sanitizedUser)
          })
        : undefined
    const removeError =
      typeof window.onAuthError === 'function'
        ? window.onAuthError(() => {
            setLoading(false)
          })
        : undefined

    return () => {
      active = false
      removeAuthenticated?.()
      removeUpdated?.()
      removeError?.()
    }
  }, [enabled, loadCredits])

  useEffect(() => {
    if (!(enabled && user)) {
      return
    }
    /** Refresh shared credit displays after a checkout return or browser focus change. */
    const refresh = (): void => {
      void loadCredits(user)
    }
    const subscription = ipcEvents.on('account:credits-updated', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      ipcEvents.removeListener('account:credits-updated', subscription)
      window.removeEventListener('focus', refresh)
    }
  }, [enabled, loadCredits, user])

  return { credits, loading, user }
}
