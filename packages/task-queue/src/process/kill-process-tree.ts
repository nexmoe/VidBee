import { execFile } from 'node:child_process'

/**
 * Kill a process together with its entire child tree, cross-platform.
 *
 * On Windows there are no POSIX signals, so `process.kill(pid, 'SIGTERM')`
 * terminates only the parent yt-dlp process and leaves its spawned ffmpeg /
 * fragment-downloader children running — the download keeps going in the
 * background after the user cancels (GitHub issue #395). `taskkill /T` walks
 * and terminates the whole process tree; `/F` forces it because yt-dlp does
 * not handle the graceful WM_CLOSE that plain taskkill sends. On POSIX we keep
 * the existing single-process signal semantics (SIGTERM grace, then SIGKILL).
 *
 * @param pid Process id to terminate; no-op when missing or non-positive.
 * @param signal Signal used on POSIX platforms.
 */
export const killProcessTree = (
  pid: number | undefined,
  signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'
): void => {
  if (pid === undefined || pid <= 0) {
    return
  }

  if (process.platform === 'win32') {
    // Best-effort: the process may already be gone, so ignore taskkill errors.
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => {
      // noop — failures mean the tree is already terminated.
    })
    return
  }

  process.kill(pid, signal)
}
