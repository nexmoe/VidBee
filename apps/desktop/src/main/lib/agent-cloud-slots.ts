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
      /** Release exactly once, and only admit a waiter when the pool is below the limit. */
      const release = (): void => {
        if (released) {
          return
        }
        released = true
        this.running = Math.max(0, this.running - 1)
        if (this.running < this.limit) {
          this.waiting.shift()?.()
        }
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

/**
 * Hold one cloud slot until the provider body ends, fails, is cancelled, or the signal aborts.
 * The slot is released exactly once from a `finally`.
 *
 * @param signal Run or request signal. Abort frees the slot even if nobody is reading.
 * @param body Provider response body that owns the slot.
 * @param release Slot release from `acquire`. Extra calls stay within the limit.
 * @param onStop Optional cancellation used when the body fails, is cancelled, or aborts.
 */
export function bindCloudSlotStream(
  signal: AbortSignal,
  body: ReadableStream<Uint8Array>,
  release: () => void,
  onStop?: () => Promise<unknown>
): ReadableStream<Uint8Array> {
  let released = false
  /** Release the shared slot once across end, failure, cancel, and abort. */
  const releaseOnce = (): void => {
    if (released) {
      return
    }
    released = true
    signal.removeEventListener('abort', onAbort)
    release()
  }
  /** Run cancellation, then release from `finally` so a rejection cannot keep the slot. */
  const stopThenRelease = async (): Promise<void> => {
    try {
      await onStop?.()
    } finally {
      releaseOnce()
    }
  }
  /** Abort frees the slot even when the consumer never reads or cancels. */
  const onAbort = (): void => {
    void stopThenRelease()
  }
  if (signal.aborted) {
    void body.cancel(signal.reason).catch(() => undefined)
    void stopThenRelease()
    return abortedCloudStream(signal.reason)
  }
  const reader = body.getReader()
  signal.addEventListener('abort', onAbort, { once: true })
  return new ReadableStream<Uint8Array>({
    /**
     * Forward one provider chunk. Release only when this read finishes the body.
     *
     * @param controller Downstream stream controller.
     */
    async pull(controller) {
      let finished = false
      try {
        const next = await reader.read()
        if (next.done) {
          finished = true
          controller.close()
        } else {
          controller.enqueue(next.value)
        }
      } catch (error) {
        finished = true
        await onStop?.()
        controller.error(error)
      } finally {
        if (finished) {
          releaseOnce()
        }
      }
    },
    /** Cancel the provider body and release the slot. */
    async cancel() {
      try {
        await onStop?.()
        await reader.cancel()
      } finally {
        releaseOnce()
      }
    }
  })
}

/** Fail the consumer with the abort reason without locking the provider body. */
function abortedCloudStream(reason: unknown): ReadableStream<Uint8Array> {
  return new ReadableStream({
    /** Surface the abort reason on the first read. */
    start(controller) {
      controller.error(reason ?? new Error('The agent run was cancelled'))
    }
  })
}
