import { Button } from '@renderer/components/ui/button'
import type { AgentChatRun } from '@shared/agent-chat'
import { classifyAiPromptError } from '@shared/ai-run'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { TranscriptPromptGuidance } from './TranscriptPromptGuidance'

/** Keep live progress and terminal feedback below the reply, outside reasoning. */
export function AgentChatRunFeedback({
  run,
  busy,
  onRetry
}: {
  run?: AgentChatRun
  busy: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation()
  if (run?.status === 'running') {
    return (
      <div
        className="flex items-center gap-2 text-muted-foreground text-sm"
        data-testid="agent-run-progress"
        role="status"
      >
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
        <span>
          {t(
            run.contextStatus
              ? `agentChat.contextStatus.${run.contextStatus}`
              : 'transcript.promptRunning'
          )}
        </span>
      </div>
    )
  }
  if (run?.status === 'error') {
    const error = run.error || t('error.unknownError')
    return (
      <div
        className="w-full rounded-lg border border-destructive/30 p-3"
        data-testid="agent-run-feedback"
        role="alert"
      >
        <TranscriptPromptGuidance
          error={error}
          errorCode={classifyAiPromptError(error)}
          onRetry={busy ? undefined : onRetry}
          usingCloud={run.model === 'vidbee-cloud'}
        />
      </div>
    )
  }
  if (run?.status !== 'aborted' && run?.status !== 'interrupted') {
    return null
  }
  return (
    <div
      className="flex w-full flex-col items-start gap-2 rounded-lg border p-3 text-muted-foreground text-sm"
      data-testid="agent-run-feedback"
      role="status"
    >
      <p>{t(run.status === 'aborted' ? 'transcript.promptAborted' : 'agentChat.interrupted')}</p>
      <Button disabled={busy} onClick={onRetry} size="sm" type="button" variant="outline">
        {t('transcript.promptTryAgain')}
      </Button>
    </div>
  )
}
