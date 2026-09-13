import { autoUpdater } from 'electron-updater'
import { scopedLoggers } from '../utils/logger'

const log = scopedLoggers.main
const STABLE_CHANNEL = 'latest'

/**
 * Pin auto-updates to the stable `latest` channel.
 * Preview opt-in is retired; leftover preview settings are ignored.
 */
export function applyUpdateChannel(): void {
  autoUpdater.allowPrerelease = false
  autoUpdater.channel = STABLE_CHANNEL
  // electron-updater's `channel` setter implicitly enables allowDowngrade.
  autoUpdater.allowDowngrade = false
  log.info(`Update channel applied: ${autoUpdater.channel}`)
}
