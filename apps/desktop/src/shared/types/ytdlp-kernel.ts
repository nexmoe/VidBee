export type YtDlpKernelState =
  | 'preparing'
  | 'checking'
  | 'installing'
  | 'up-to-date'
  | 'retry-scheduled'
  | 'bundled-fallback'
  | 'unavailable'

export type YtDlpKernelPreparationStep = 'copying' | 'validating' | 'finalizing' | null

export interface YtDlpKernelStatus {
  ready: boolean
  state: YtDlpKernelState
  source: 'managed' | 'bundled' | null
  ytDlpVersion: string | null
  nodeVersion: string | null
  progress: number | null
  preparationStep: YtDlpKernelPreparationStep
  /** User-copyable diagnostic when preparation ends in `unavailable`. */
  error: string | null
}
