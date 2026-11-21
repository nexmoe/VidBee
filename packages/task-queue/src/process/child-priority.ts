import * as os from 'node:os'

/** Scheduling priority below the default so media work yields to the foreground. */
export const BACKGROUND_CHILD_PRIORITY = 10

/** Encode thread cap. Stream-copy commands do not use it. */
export const FFMPEG_ENCODE_THREADS = '2'

/**
 * Spawn options that put a long-running child in its own POSIX process group.
 * Windows stays attached so `taskkill /T` still owns the tree.
 */
export const backgroundChildSpawnOptions = (): { detached: boolean } => ({
  detached: process.platform !== 'win32'
})

/**
 * Lower a spawned child's scheduling priority.
 * Missing pids and rejected calls are ignored so a race with exit is harmless.
 *
 * @param pid Child process id from spawn.
 */
export const lowerChildPriority = (pid: number | undefined): void => {
  if (!pid || pid <= 0) {
    return
  }
  try {
    os.setPriority(pid, BACKGROUND_CHILD_PRIORITY)
  } catch {
    // Permission errors and already-exited processes are non-fatal.
  }
}
