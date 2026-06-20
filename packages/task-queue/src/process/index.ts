export { killProcessTree } from './kill-process-tree'
export { ProcessRegistry } from './registry'
export type { ProcessHandle, ProcessRegistryDeps } from './registry'
export { Watchdog } from './watchdog'
export type { WatchdogConfig, WatchdogEntry } from './watchdog'
export {
  readPidStartTime,
  setReadPidStartTimeImpl,
  isPidAlive
} from './pid-start-time'
export type { ReadPidStartTimeFn } from './pid-start-time'
