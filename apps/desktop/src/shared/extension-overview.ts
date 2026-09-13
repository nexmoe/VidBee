import type { AiPromptErrorCode, AiPromptRunStatus } from './ai-types'

/** Browser captions supplied to Desktop's existing Overview runner. */
export interface ExtensionOverviewInput {
  requestId: string
  sourceUrl: string
  transcriptText: string
  transcriptLanguage?: string
  transcriptOrigin?: 'ai' | 'human'
  uiLanguage?: string
}

/** Public result only; provider credentials and model reasoning stay in Desktop. */
export interface ExtensionOverviewSnapshot {
  status: AiPromptRunStatus
  text: string
  error: string | null
  errorCode: AiPromptErrorCode | null
  updatedAt: number
}

/** A short-lived capability grants access to only the run started by this caller. */
export interface ExtensionOverviewJob {
  id: string
  token: string
  snapshot: ExtensionOverviewSnapshot
}
