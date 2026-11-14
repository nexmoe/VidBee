import { Copy } from 'lucide-react'
import type { Ref, UIEventHandler } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from './button'

interface DownloadLogsProps {
  isLive: boolean
  logAutoScroll: boolean
  logContainerRef: Ref<HTMLDivElement>
  logContent: string
  onLogScroll: UIEventHandler<HTMLDivElement>
  ytDlpCommand?: string
}

/** Show selectable download diagnostics with the same copy action on every platform. */
export function DownloadLogs({
  isLive,
  logAutoScroll,
  logContainerRef,
  logContent,
  onLogScroll,
  ytDlpCommand
}: DownloadLogsProps) {
  const { t } = useTranslation()
  const command = ytDlpCommand?.trim() ?? ''
  const hasLogContent = logContent.trim().length > 0
  const copyText = [command, hasLogContent ? logContent : ''].filter(Boolean).join('\n\n')

  /** Copy all loaded output locally and report success only after the clipboard accepts it. */
  const handleCopyLogs = async (): Promise<void> => {
    try {
      if (!navigator.clipboard?.writeText) {
        toast.error(t('notifications.copyFailed'))
        return
      }
      await navigator.clipboard.writeText(copyText)
      toast.success(t('download.logs.copied'))
    } catch {
      toast.error(t('notifications.copyFailed'))
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
        <span>{isLive ? t('download.logs.live') : t('download.logs.history')}</span>
        <div className="flex items-center gap-2">
          {logAutoScroll ? null : (
            <span className="text-muted-foreground/70">{t('download.logs.scrollPaused')}</span>
          )}
          <Button
            disabled={!copyText}
            onClick={() => {
              void handleCopyLogs()
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <Copy aria-hidden="true" />
            {t('download.logs.copy')}
          </Button>
        </div>
      </div>
      {command && (
        <div className="rounded-md border border-border/60 bg-muted/20 p-2">
          <div className="font-medium text-[11px] text-muted-foreground">
            {t('download.logs.command')}
          </div>
          <div className="mt-1 select-text whitespace-pre-wrap break-words font-mono text-xs">
            {command}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 rounded-md border border-border/60 bg-muted/30">
        <div
          className="h-full select-text overflow-y-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed"
          onScroll={onLogScroll}
          ref={logContainerRef}
        >
          {hasLogContent ? logContent : t('download.logs.empty')}
        </div>
      </div>
    </>
  )
}
