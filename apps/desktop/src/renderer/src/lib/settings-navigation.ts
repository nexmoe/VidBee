import type { SettingsTab } from '@renderer/router'

/** Navigate to one Settings tab through the app's hash history. */
export function openSettingsTab(tab: SettingsTab): void {
  window.location.hash = `/settings?tab=${encodeURIComponent(tab)}`
}

/** Open Settings → Account and start desktop sign-in when no session exists. */
export async function continueDesktopSignIn(): Promise<void> {
  openSettingsTab('account')
  if (typeof window.getUser !== 'function' || typeof window.requestAuth !== 'function') {
    return
  }
  const user = await window.getUser()
  if (!user) {
    await window.requestAuth()
  }
}
