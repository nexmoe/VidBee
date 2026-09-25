import type { AgentFailure } from '../../shared/agent-errors'
import {
  type AgentTurnLike,
  assistantDeliveredArticle,
  truncatedAgentRecovery
} from './agent-progress'

export type RunPhase =
  | 'prepare'
  | 'stream'
  | 'continue-truncated'
  | 'sectioned-write'
  | 'finalize'
  | 'settle'

export interface RunSignals {
  lastAssistant?: AgentTurnLike
  handoffRequested: boolean
  sectionedRetry: boolean
  allowSectionedWrite: boolean
  aborted: boolean
  failure?: AgentFailure
}

/**
 * Pure decision: given what just happened, which phase runs next.
 *
 * Encodes the recovery ladder: normal → truncated continuation → sectioned
 * handoff → sectioned retry, plus abort and failure settlement.
 *
 * @param current Phase that just finished (or `prepare` before the first step).
 * @param signals Observable outcomes from that phase.
 */
export function nextRunPhase(current: RunPhase, signals: RunSignals): RunPhase {
  if (current === 'settle') {
    return 'settle'
  }
  if (signals.aborted || signals.failure) {
    return current === 'finalize'
      ? 'settle'
      : current === 'prepare' ||
          current === 'stream' ||
          current === 'continue-truncated' ||
          current === 'sectioned-write'
        ? 'settle'
        : 'settle'
  }
  switch (current) {
    case 'prepare':
      return signals.sectionedRetry ? 'sectioned-write' : 'stream'
    case 'stream':
      return afterGeneration(signals)
    case 'continue-truncated':
      return afterGeneration(signals, true)
    case 'sectioned-write':
      return 'finalize'
    case 'finalize':
      return 'settle'
    default:
      return 'settle'
  }
}

/**
 * Choose the next phase after a model generation turn.
 *
 * @param signals Latest assistant outcome and handoff flags.
 * @param afterContinuation True when the truncated continuation already ran.
 */
function afterGeneration(signals: RunSignals, afterContinuation = false): RunPhase {
  if (signals.handoffRequested) {
    return 'sectioned-write'
  }
  if (assistantDeliveredArticle(signals.lastAssistant ?? {})) {
    return 'finalize'
  }
  const recovery = truncatedAgentRecovery({
    last: signals.lastAssistant,
    allowSectionedWrite: signals.allowSectionedWrite
  })
  if (recovery === 'sectioned') {
    return 'sectioned-write'
  }
  if (recovery === 'continue' && !afterContinuation) {
    return 'continue-truncated'
  }
  if (recovery === 'continue' && afterContinuation && signals.allowSectionedWrite) {
    return 'sectioned-write'
  }
  return 'finalize'
}
