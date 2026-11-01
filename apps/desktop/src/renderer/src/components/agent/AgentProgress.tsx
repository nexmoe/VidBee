import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import type { AgentArtifact, AgentChatRun, AgentRunStatus } from '@shared/agent-chat'
import { agentProgressState } from '@shared/agent-progress'
import type { AgentProgressStep } from '@shared/agent-ui'
import { Check, ChevronDown, File, Loader2, Square } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Render an explicitly reported plan stage; tool calls remain in the reasoning history. */
function PlanStep({
  step,
  runStatus,
  index
}: {
  step: AgentProgressStep
  runStatus: AgentRunStatus
  index: number
}) {
  const { t } = useTranslation()
  const active = runStatus === 'running' && step.status === 'running'
  const inactive = runStatus !== 'running' && step.status === 'running'
  const completed = step.status === 'completed'
  const status = inactive
    ? t(`agentChat.progress.${runStatus}`)
    : step.status === 'pending'
      ? t('agentChat.progress.pending')
      : t(`agentChat.eventStatus.${step.status}`)
  return (
    <li
      className="relative flex items-start gap-3 pb-3 text-xs after:absolute after:top-6 after:bottom-1 after:left-[9.5px] after:w-px after:bg-border/60 last:pb-0 last:after:hidden"
      data-status={step.status}
    >
      <span
        aria-hidden
        className={`relative flex size-5 shrink-0 items-center justify-center rounded-full ${active ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}
      >
        {active ? (
          <Loader2 className="size-3 animate-spin" />
        ) : completed ? (
          <Check className="size-3" />
        ) : (
          <span className="text-[10px] tabular-nums">{index + 1}</span>
        )}
      </span>
      <span
        className={`min-w-0 break-words leading-5 ${active ? 'font-medium' : 'text-muted-foreground'}`}
      >
        {step.label}
        <span className="sr-only"> · {status}</span>
      </span>
    </li>
  )
}

/** Combine the explicit user-facing plan with authoritative run state and background task facts. */
export function AgentProgress({
  title,
  steps = [],
  run,
  current,
  artifacts,
  onStop,
  children
}: {
  title?: string
  steps?: AgentProgressStep[]
  run: AgentChatRun
  current: boolean
  artifacts: AgentArtifact[]
  onStop?: () => Promise<void>
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(run.status === 'running')
  const [stopping, setStopping] = useState(false)
  const contentId = useId()
  const state = agentProgressState(run, current)
  const activeStep = steps.find((step) => step.status === 'running')
  const running = run.status === 'running'
  const completedSteps = steps.filter((step) => step.status === 'completed').length
  const currentLabel =
    state === 'running' && activeStep ? activeStep.label : t(`agentChat.progress.${state}`)

  /** Stop only the owning Agent run through the conversation's existing cancellation path. */
  async function stop(): Promise<void> {
    if (!onStop || stopping) {
      return
    }
    setStopping(true)
    try {
      await onStop()
    } finally {
      setStopping(false)
    }
  }

  if (!steps.length) {
    return null
  }

  return (
    <section
      className="min-w-0 rounded-xl border border-border/60 bg-background"
      data-state={state}
      data-testid="agent-progress"
    >
      <div className="flex items-start gap-2 px-4 py-3">
        <button
          aria-controls={contentId}
          aria-expanded={open}
          className="min-w-0 flex-1 rounded-sm py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <span className="flex items-start gap-2">
            <span className="min-w-0 flex-1 break-words font-medium text-sm leading-5">
              {title ?? t('agentChat.progress.title')}
            </span>
            <span className="shrink-0 text-muted-foreground text-xs tabular-nums leading-5">
              {completedSteps} / {steps.length}
            </span>
            <ChevronDown
              aria-hidden
              className={`mt-0.5 size-4 shrink-0 text-muted-foreground ${open ? 'rotate-180' : ''}`}
            />
          </span>
          <span
            aria-live="polite"
            className={
              open && state === 'running'
                ? 'sr-only'
                : 'mt-1 block text-muted-foreground text-xs leading-5'
            }
            role="status"
          >
            {currentLabel}
          </span>
        </button>
        {running && current && onStop ? (
          <Button
            aria-label={t('agentChat.progress.stop')}
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
            disabled={stopping}
            onClick={() => void stop()}
            size="icon"
            title={`${t('agentChat.progress.stop')} · ${t('agentChat.progress.stopHint')}`}
            type="button"
            variant="ghost"
          >
            <Square aria-hidden className="size-3" />
          </Button>
        ) : null}
      </div>
      {state === 'waiting' ? (
        <p className="px-4 pb-3 text-muted-foreground text-xs">
          {t('agentChat.progress.continueAfterWait')}
        </p>
      ) : null}
      <div hidden={!open} id={contentId}>
        <div className="space-y-4 px-4 pt-1 pb-4">
          <ol aria-label={t('agentChat.progress.steps')}>
            {steps.map((step, index) => (
              <PlanStep index={index} key={step.id} runStatus={run.status} step={step} />
            ))}
          </ol>
          {children}
          {artifacts.length ? (
            <div className="space-y-2">
              <h4 className="font-medium text-muted-foreground text-xs">
                {t('agentChat.progress.results')}
              </h4>
              <ul className="space-y-2">
                {artifacts.map((artifact) => (
                  <li className="flex min-w-0 items-center gap-2 text-xs" key={artifact.id}>
                    <File aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="break-all">{artifact.name}</span>
                    <Badge className="ml-auto shrink-0" variant="outline">
                      {t('agentChat.eventStatus.completed')}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
