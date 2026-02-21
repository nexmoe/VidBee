/**
 * Renderer process logger utility
 * Use electron-log/renderer which automatically forwards logs to main process
 */

import log from 'electron-log/renderer'

// Export electron-log instance
export default log

// Export commonly used logging methods
export const logger = log

// Predefined scoped loggers
export const scopedLoggers = {
  renderer: log.scope('renderer'),
  error: log.scope('error'),
  component: log.scope('component'),
  api: log.scope('api')
}
