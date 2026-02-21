/**
 * Main process logger utility
 * Directly use electron-log/main
 */

import log from 'electron-log/main'

// Export electron-log instance
export default log

// Export commonly used logging methods
export const logger = log

// Predefined scoped loggers
export const scopedLoggers = {
  main: log.scope('main'),
  ipc: log.scope('ipc'),
  window: log.scope('window'),
  download: log.scope('download'),
  engine: log.scope('engine'),
  system: log.scope('system'),
  storage: log.scope('storage'),
  thumbnail: log.scope('thumbnail'),
  history: log.scope('history')
}
