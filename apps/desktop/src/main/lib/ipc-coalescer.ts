/** Minimum gap between renderer log IPC flushes. */
export const LOG_IPC_INTERVAL_MS = 200

/** Progress IPC ceiling of about 4Hz. */
export const PROGRESS_IPC_INTERVAL_MS = 250

export interface KeyedCoalescer<T> {
  /**
   * Queue a value for this key. It is merged into the pending payload and flushed on the interval.
   *
   * @param key Task id.
   * @param value Next value.
   */
  push(key: string, value: T): void
  /**
   * Send any pending payload for this key now.
   *
   * @param key Task id.
   */
  flush(key: string): void
  /**
   * Drop a pending payload and its timer without sending.
   *
   * @param key Task id.
   */
  clear(key: string): void
  /** Drop every key. */
  dispose(): void
}

/**
 * Coalesce per-key IPC payloads so a burst becomes one emit per interval.
 * `merge` either appends (logs) or keeps the latest snapshot (progress).
 *
 * @param options Interval, merge, and emit callback.
 */
export function createKeyedCoalescer<T>(options: {
  intervalMs: number
  merge: (pending: T | undefined, next: T) => T
  emit: (key: string, value: T) => void
}): KeyedCoalescer<T> {
  const pending = new Map<string, T>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * Send the pending payload for one key and cancel its timer.
   *
   * @param key Task id.
   */
  const flush = (key: string): void => {
    const timer = timers.get(key)
    if (timer) {
      clearTimeout(timer)
      timers.delete(key)
    }
    if (!pending.has(key)) {
      return
    }
    const value = pending.get(key) as T
    pending.delete(key)
    options.emit(key, value)
  }

  return {
    push(key, value) {
      pending.set(key, options.merge(pending.has(key) ? pending.get(key) : undefined, value))
      if (timers.has(key)) {
        return
      }
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key)
          flush(key)
        }, options.intervalMs)
      )
    },
    flush,
    clear(key) {
      const timer = timers.get(key)
      if (timer) {
        clearTimeout(timer)
      }
      timers.delete(key)
      pending.delete(key)
    },
    dispose() {
      for (const key of [...timers.keys(), ...pending.keys()]) {
        const timer = timers.get(key)
        if (timer) {
          clearTimeout(timer)
        }
        timers.delete(key)
        pending.delete(key)
      }
    }
  }
}
