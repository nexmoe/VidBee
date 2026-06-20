import { autoUpdater } from 'electron-updater'
import { scopedLoggers } from '../utils/logger'

const log = scopedLoggers.main

// electron-updater channel names. Preview maps to the `preview.yml` files that
// electron-builder generates for `x.y.z-preview.n` versions.
const STABLE_CHANNEL = 'latest'
const PREVIEW_CHANNEL = 'preview'

/**
 * Applies the auto-update channel and related flags for the given preview-program state.
 * Preview opts the user into prerelease builds; stable stays on `latest` and never downgrades,
 * so leaving preview keeps the current build until the next stable release catches up.
 * @param beta Whether the preview channel is enabled.
 */
export function applyUpdateChannel(beta: boolean): void {
  autoUpdater.allowPrerelease = beta
  autoUpdater.channel = beta ? PREVIEW_CHANNEL : STABLE_CHANNEL
  // Always assign explicitly: electron-updater's `channel` setter implicitly enables
  // allowDowngrade, which we never want (see leave-preview behavior above).
  autoUpdater.allowDowngrade = false
  log.info(`Update channel applied: ${autoUpdater.channel} (allowPrerelease=${beta})`)
}

/**
 * Re-applies the update channel and immediately re-checks for updates.
 * Used when the user toggles the preview channel at runtime.
 * @param beta Whether the preview channel is enabled.
 */
export function refreshUpdateChannel(beta: boolean): void {
  applyUpdateChannel(beta)
  void autoUpdater.checkForUpdates()
}
