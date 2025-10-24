import log from 'electron-log/main'

/**
 * Configure electron-log
 * Set log format, file path, transport methods, etc.
 */
export function configureLogger() {
  // Configure console output format - support colors and scope, time in gray
  log.transports.console.format = '%c{h}:{i}:{s}%c [{level}]{scope} {text}'

  // Enable console colors
  log.transports.console.useStyles = true

  // Configure file output format - include scope information
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {scope} {text}'

  // Set log levels
  // Development: show all logs
  // Production: show info level and above only
  const isDev = process.env.NODE_ENV === 'development'
  log.transports.console.level = isDev ? 'silly' : 'info'
  log.transports.file.level = isDev ? 'silly' : 'info'

  // Enable IPC transport in development environment to show renderer process logs in main process console
  if (isDev) {
    log.transports.ipc.level = 'silly'
  } else {
    log.transports.ipc.level = false
  }

  // Set maximum log file size (10MB)
  log.transports.file.maxSize = 10 * 1024 * 1024

  // Enable error catching - catch unhandled errors and rejected promises
  log.errorHandler.startCatching({
    showDialog: false, // Don't show error dialog, only log to file
    onError: (options) => {
      log.error('Unhandled error caught by electron-log:', options.error)
      log.error('App versions:', options.versions)
    }
  })

  log.info('Log file location:', log.transports.file.getFile().path)
}
