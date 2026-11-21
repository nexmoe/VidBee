interface CohortStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
type Properties = Record<string, unknown>
type EventSink = (name: string, properties?: Properties) => boolean
const DAY_MS = 86_400_000

/** Maintain local observation cohorts without exporting identities, raw timestamps or historical tasks. */
export function createDesktopValueCohorts(
  send: EventSink,
  storage: CohortStorage,
  prefix: string,
  now: () => number = () => Date.now()
) {
  const memory = new Map<string, string>()

  /** Read legacy flags as existing milestones, while retaining in-memory state if storage fails. */
  function read(name: string): string | null {
    if (memory.has(name)) {
      return memory.get(name) ?? null
    }
    try {
      const value = storage.getItem(`${prefix}:${name}`)
      if (value) {
        memory.set(name, value)
      }
      return value
    } catch {
      return null
    }
  }

  /** Persist only accepted milestones; storage failures never interrupt product operations. */
  function write(name: string, value: string): void {
    memory.set(name, value)
    try {
      storage.setItem(`${prefix}:${name}`, value)
    } catch {
      /* The session guard remains available. */
    }
  }

  /** A legacy "1" flag has no recoverable date and must never become a fabricated cohort. */
  function timestamp(value: string | null): number | null {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) &&
      parsed >= 1_000_000_000_000 &&
      parsed <= 8_640_000_000_000_000
      ? parsed
      : null
  }

  /** Use UTC cohort dates so reports can select the same cohort across property timezones. */
  function date(value: number | null): string {
    return value === null ? 'unknown' : new Date(value).toISOString().slice(0, 10)
  }

  return {
    /** Enter the first observable cohort only after the caller has loaded consent and transport. */
    opened(): void {
      if (read('desktop_first_observed')) {
        return
      }
      const at = now()
      if (send('desktop_first_observed', { observed_cohort_date: date(at) })) {
        write('desktop_first_observed', String(at))
      }
    },

    /** Record value plus exact elapsed-time activation and first-value-relative week-one delivery. */
    value(properties: Properties = {}): boolean {
      const at = now()
      const observedAt = timestamp(read('desktop_first_observed'))
      const existingValue = read('desktop_first_value_delivered')
      const firstValueAt = existingValue ? timestamp(existingValue) : at
      const context = {
        ...properties,
        observed_cohort_date: date(observedAt),
        value_cohort_date: date(firstValueAt)
      }
      if (!send('desktop_value_delivered', context)) {
        return false
      }
      if (!existingValue && send('desktop_first_value_delivered', context)) {
        write('desktop_first_value_delivered', String(at))
        if (observedAt !== null && at >= observedAt && at - observedAt < 7 * DAY_MS) {
          send('desktop_activated_7d', context)
        }
      }
      if (
        firstValueAt !== null &&
        at - firstValueAt >= 7 * DAY_MS &&
        at - firstValueAt < 14 * DAY_MS &&
        !read('desktop_value_retained_w1') &&
        send('desktop_value_retained_w1', context)
      ) {
        write('desktop_value_retained_w1', '1')
      }
      return true
    }
  }
}
