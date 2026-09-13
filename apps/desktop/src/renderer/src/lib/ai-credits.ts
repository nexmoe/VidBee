/** Format AI credit balances using compact K product language. */
export function formatAiCredits(credits: number): string {
  if (credits < 1000) {
    return Math.max(0, Math.round(credits)).toString()
  }
  const thousands = credits / 1000
  return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`
}

export interface CreditUsageBarSegments {
  expiringPct: number
  reservedPct: number
  stablePct: number
  usedPct: number
}

/** True when the account has both gifted and purchased credit quotas to show separately. */
export function hasSplitCreditSources(credits: {
  bySource?: {
    granted: { quotaCredits: number }
    purchased: { quotaCredits: number }
  }
}): boolean {
  return (
    (credits.bySource?.granted.quotaCredits ?? 0) > 0 &&
    (credits.bySource?.purchased.quotaCredits ?? 0) > 0
  )
}

/** Use actual balances so expired grants cannot make available credits look used. */
export function creditUsageBarSegments(params: {
  expiringSoonCredits: number
  remainingCredits: number
  reservedCredits: number
  usedCredits: number
}): CreditUsageBarSegments {
  const used = Math.max(0, params.usedCredits)
  const reserved = Math.max(0, params.reservedCredits)
  const remaining = Math.max(0, params.remainingCredits)
  const total = used + reserved + remaining
  if (total <= 0) {
    return { expiringPct: 0, reservedPct: 0, stablePct: 0, usedPct: 0 }
  }
  const expiring = Math.min(Math.max(0, params.expiringSoonCredits), remaining)
  return {
    expiringPct: (expiring / total) * 100,
    reservedPct: (reserved / total) * 100,
    stablePct: ((remaining - expiring) / total) * 100,
    usedPct: (used / total) * 100
  }
}
