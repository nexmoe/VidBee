export interface DesktopAuthUser {
  email: string
  id: string
  image: string | null
  name: string
}

export interface DesktopAiCreditSourceUsage {
  expiringSoonCredits: number
  quotaCredits: number
  remainingCredits: number
  reservedCredits: number
  usedCredits: number
}

export interface DesktopAiCreditUsage {
  byFeature: {
    prompt: number
    transcription: number
  }
  bySource?: {
    granted: DesktopAiCreditSourceUsage
    purchased: DesktopAiCreditSourceUsage
  }
  expiringSoonCredits: number
  /** Settled charges from failed, cancelled, or timed-out prompts, included in usedCredits. */
  interruptedCredits?: number
  quotaCredits: number
  remainingCredits: number
  reservedCredits: number
  reconcilingCredits?: number
  usedCredits: number
}

export interface DesktopInvitationOverview {
  code: string
  earnedCredits: number
  invitedUsers: number
  inviteUrl: string
}

export interface DesktopInvitedUser {
  createdAt: string
  id: string
  image: string | null
  name: string
  rewardCredits: number
}

export interface DesktopGiftedCreditRecord {
  createdAt: string
  credits: number
  expiresAt: string | null
  id: string
  reason: 'admin' | 'invite_invitee' | 'invite_inviter' | 'welcome'
  relatedUser: {
    image: string | null
    name: string
  } | null
}

export interface DesktopPaginatedResult<T> {
  items: T[]
  nextCursor: string | null
}

export type DesktopCloudCacheStats = Record<
  'today' | 'week' | 'month' | 'all',
  {
    hits: number
    misses: number
    bypasses: number
    hitRate: number | null
  }
>

/** An authenticated task hold; reconciliation is included in the reserved balance. */
export interface DesktopAiReservation {
  createdAt: number
  deadlineAt: number
  expiresAt: number
  lastHeartbeatAt: number
  lastProgressAt: number
  requestId: string
  reservedCredits: number
  status: 'reserved' | 'reconciling'
  taskLabel: string | null
}

export interface DesktopAiCreditHistoryCursor {
  at: number
  id: string
}

export interface DesktopAiCreditReceipt {
  id: string
  requestId: string
  createdAt: number
  feature: string
  taskLabel: string | null
  status: string
  credits: number
  refundedCredits: number
  basis: string | null
  pricingVersion: string | null
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
}

export interface DesktopAiCreditHistory {
  items: DesktopAiCreditReceipt[]
  nextCursor: DesktopAiCreditHistoryCursor | null
}
