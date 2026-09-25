import type { AiPromptErrorCode, AiPromptRunStatus } from './ai-types'

/** Browser captions supplied to Desktop's existing Overview runner. */
export interface ExtensionOverviewInput {
  requestId: string
  sourceUrl: string
  transcriptText: string
  transcriptLanguage?: string
  transcriptOrigin?: 'ai' | 'human'
  uiLanguage?: string
  /** Skip attaching a Desktop download Overview and start a fresh ephemeral run. */
  forceRegenerate?: boolean
}

/** Public result only; provider credentials stay in Desktop. */
export interface ExtensionOverviewSnapshot {
  status: AiPromptRunStatus
  text: string
  error: string | null
  errorCode: AiPromptErrorCode | null
  /** Model reasoning shown in the same ThinkingSteps rail Desktop streams. */
  thinking: string
  /** Elapsed reasoning time for the same Thinking header Desktop shows. */
  thinkingMs: number
  updatedAt: number
}

/** A short-lived capability grants access to only the run started by this caller. */
export interface ExtensionOverviewJob {
  id: string
  token: string
  snapshot: ExtensionOverviewSnapshot
}
