import { useAppInfo } from '@renderer/components/feedback/FeedbackLinks'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import type { YtDlpKernelStatus } from '@shared/types'
import { AlertCircle, Copy, Github } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { logger } from '../../lib/logger'
import { buildKernelErrorReport, buildKernelIssueUrl } from './kernel-error-report'

interface KernelPreparationScreenProps {
  onRetry: () => Promise<void> | void
  status: YtDlpKernelStatus
}

/**
 * Render the full-window local kernel preparation and recovery state.
 */
export function KernelPreparationScreen({ onRetry, status }: KernelPreparationScreenProps) {
  const { t } = useTranslation()
  const appInfo = useAppInfo()
  const [retrying, setRetrying] = useState(false)
  const [copied, setCopied] = useState(false)
  const isUnavailable = status.state === 'unavailable'
  const phaseKey = status.preparationStep
    ? `kernelPreparation.${status.preparationStep}`
    : 'kernelPreparation.copying'
  const errorText = status.error?.trim() || t('kernelPreparation.missingError')
  const errorReport = useMemo(() => buildKernelErrorReport(status, appInfo), [appInfo, status])
  const issueUrl = useMemo(() => buildKernelIssueUrl(errorReport, appInfo), [appInfo, errorReport])

  /**
   * Retry preparation while preventing duplicate clicks.
   */
  const handleRetry = async (): Promise<void> => {
    setRetrying(true)
    try {
      await onRetry()
    } catch (error) {
      logger.error('Failed to retry yt-dlp kernel preparation:', error)
    } finally {
      setRetrying(false)
    }
  }

  /**
   * Copy the diagnostic report so it can be pasted into an issue or chat.
   */
  const handleCopy = async (): Promise<void> => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard is unavailable')
      }
      await navigator.clipboard.writeText(errorReport)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      logger.error('Failed to copy kernel error report:', error)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-background px-6 py-8">
      <div
        aria-live={isUnavailable ? 'assertive' : undefined}
        className={`flex w-full flex-col items-center text-center ${
          isUnavailable ? 'max-w-lg' : 'max-w-xs'
        }`}
        role={isUnavailable ? 'alert' : undefined}
      >
        {isUnavailable ? (
          <>
            <AlertCircle aria-hidden="true" className="mb-4 h-10 w-10 text-destructive" />
            <h1 className="font-semibold text-xl tracking-tight">
              {t('kernelPreparation.errorTitle')}
            </h1>
            <p className="mt-2 text-muted-foreground text-sm leading-6">
              {t('kernelPreparation.errorDescription')}
            </p>
            <div className="mt-5 w-full rounded-lg border bg-muted/40 p-3 text-left">
              <p className="mb-2 font-medium text-muted-foreground text-xs">
                {t('kernelPreparation.errorDetails')}
              </p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-muted-foreground text-xs leading-5">
                {errorText}
              </pre>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <Button className="min-h-11 min-w-28" disabled={retrying} onClick={handleRetry}>
                {t(retrying ? 'kernelPreparation.retrying' : 'kernelPreparation.retry')}
              </Button>
              <Button
                className="min-h-11"
                onClick={() => void handleCopy()}
                type="button"
                variant="outline"
              >
                <Copy />
                {t(copied ? 'kernelPreparation.copied' : 'kernelPreparation.copyLog')}
              </Button>
              <Button asChild className="min-h-11" variant="outline">
                <a href={issueUrl} rel="noreferrer" target="_blank">
                  <Github />
                  {t('kernelPreparation.reportIssue')}
                </a>
              </Button>
            </div>
          </>
        ) : (
          <>
            <img alt="VidBee" className="mb-5 h-14 w-14 rounded-xl" src="./app-icon.png" />
            <output aria-live="polite" className="block">
              <h1 className="font-medium text-base text-foreground">{t(phaseKey)}</h1>
            </output>
            <Progress
              aria-label={t('kernelPreparation.progressLabel')}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={status.progress ?? undefined}
              className="mt-4 h-1.5"
              value={status.progress ?? 0}
            />
          </>
        )}
      </div>
    </div>
  )
}
