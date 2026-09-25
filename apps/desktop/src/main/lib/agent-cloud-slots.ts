/** Fallback when a capabilities profile does not advertise stream capacity. */
export const CLOUD_AGENT_CONCURRENCY = 2

/** Share stream-lifetime capacity so parallel sections and other conversations cannot oversubscribe it. */
export class AgentCloudSlots {
  private running = 0
  private limit: number
  private readonly waiting: (() => void)[] = []

  constructor(limit = CLOUD_AGENT_CONCURRENCY) {
    this.limit = Math.max(1, limit)
  }

  /**
   * Resize from the latest capabilities profile without aborting in-flight streams.
   *
   * @param limit concurrentStreams from the Cloud profile.
   */
  setLimit(limit: number): void {
    this.limit = Math.max(1, limit)
    while (this.running < this.limit) {
      const start = this.waiting.shift()
      if (!start) {
        break
      }
      start()
    }
  }

  /** Reserve FIFO capacity; a cancelled waiter never starts a provider request. */
  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      /** Release exactly once, then give the oldest waiter the available slot. */
      const release = (): void => {
        if (released) {
          return
        }
        released = true
        this.running -= 1
        this.waiting.shift()?.()
      }
      let released = false
      /** Transfer ownership before resolving so another caller cannot take the same slot. */
      const start = (): void => {
        signal.removeEventListener('abort', abort)
        this.running += 1
        resolve(release)
      }
      /** Remove a queued request without disturbing in-flight streams. */
      const abort = (): void => {
        const index = this.waiting.indexOf(start)
        if (index >= 0) {
          this.waiting.splice(index, 1)
        }
        reject(signal.reason)
      }
      if (this.running < this.limit) {
        start()
      } else {
        this.waiting.push(start)
        signal.addEventListener('abort', abort, { once: true })
      }
    })
  }
}
