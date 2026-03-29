import type { AppSettings } from '../../shared/types'

interface SettingSideEffectHandlers {
  onLanguage: () => void
  onHideDockIcon: (value: boolean) => void
  onLaunchAtLogin: (value: boolean) => void
  onMaxConcurrentDownloads: (value: number) => void
}

/**
 * Applies side effects for a single setting update.
 */
export const applySingleSettingSideEffects = <K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
  handlers: SettingSideEffectHandlers
): void => {
  if (key === 'language') {
    handlers.onLanguage()
    return
  }

  if (key === 'hideDockIcon') {
    handlers.onHideDockIcon(Boolean(value))
    return
  }

  if (key === 'launchAtLogin') {
    handlers.onLaunchAtLogin(Boolean(value))
    return
  }

  if (key === 'maxConcurrentDownloads') {
    handlers.onMaxConcurrentDownloads(Number(value))
  }
}

/**
 * Applies side effects for a batch settings update.
 */
export const applyBatchSettingSideEffects = (
  settings: Partial<AppSettings>,
  handlers: SettingSideEffectHandlers
): void => {
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) {
      continue
    }
    applySingleSettingSideEffects(key as keyof AppSettings, value, handlers)
  }
}
