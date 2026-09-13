import { Progress } from '@renderer/components/ui/progress'
import {
  type TranscriptModelPrepStatus,
  useTranscriptModelPrep
} from '@renderer/store/transcript-models'
import { useTranslation } from 'react-i18next'

/**
 * Render the boot-model download bar from an already-resolved prep snapshot.
 */
export function TranscriptModelsBannerView({ status }: { status: TranscriptModelPrepStatus }) {
  const { t } = useTranslation()
  if (status.ready || !status.downloading) {
    return null
  }

  return (
    <div className="border-border/60 border-t bg-muted/40 px-4 py-2">
      <div className="flex items-center gap-3">
        <p className="shrink-0 text-muted-foreground text-xs">{t('transcript.modelsPreparing')}</p>
        <Progress
          aria-label={t('transcript.modelsProgressLabel')}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={status.percent}
          className="h-1.5 flex-1"
          value={status.percent}
        />
        <span className="w-8 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
          {status.percent}%
        </span>
      </div>
    </div>
  )
}

/**
 * Show the boot-model progress bar only while files are actively downloading.
 */
export function TranscriptModelsBanner() {
  const status = useTranscriptModelPrep()
  return <TranscriptModelsBannerView status={status} />
}
