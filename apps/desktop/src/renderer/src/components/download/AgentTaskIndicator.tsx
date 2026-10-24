import { aiModelIconComponent } from '@renderer/components/settings/ai-provider-icon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import type { AgentRunStatus } from '@shared/agent-chat'
import { AI_CHAT_PROMPT_ID } from '@shared/ai-prompts'
import type { AiSettingsSnapshot } from '@shared/ai-types'
import { useNavigate } from '@tanstack/react-router'
import {
  DOWNLOAD_STACK_BUSY_RING_CLASS,
  DOWNLOAD_STACK_CHIP_CLASS
} from '@vidbee/ui/components/ui/download-content-stack'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { aiPromptLabel } from '../../lib/ai-prompt-label'
import { cn } from '../../lib/utils'
import type { AgentTaskActivity } from '../../store/agent-tasks'

/** Distinct models beyond this count are listed in the tooltip only. */
const MAX_STACKED_CHIPS = 3

/** Model id the desktop runner records for VidBee Cloud runs. */
const VIDBEE_CLOUD_MODEL_ID = 'vidbee-cloud'

type StatusKey = 'running' | 'completed' | 'failed' | 'stopped'

const STATUS_KEY: Record<AgentRunStatus, StatusKey> = {
  running: 'running',
  completed: 'completed',
  error: 'failed',
  aborted: 'stopped',
  interrupted: 'stopped'
}

const STATUS_TEXT_CLASS: Record<StatusKey, string> = {
  running: 'text-primary',
  completed: 'opacity-70',
  failed: 'text-destructive',
  stopped: 'opacity-70'
}

interface AgentTaskIndicatorProps {
  /** Latest result per conversation for this video, running first. */
  tasks: AgentTaskActivity[]
  aiSnapshot: AiSettingsSnapshot | null
}

/**
 * Visible name for one result: the skill title, or the chat title for free conversations.
 *
 * @param task Agent result.
 * @param aiSnapshot Prompt records, when loaded.
 * @param t i18n function.
 */
function agentTaskName(
  task: AgentTaskActivity,
  aiSnapshot: AiSettingsSnapshot | null,
  t: (key: string) => string
): string {
  if (task.promptId === AI_CHAT_PROMPT_ID) {
    return task.title || t('transcript.promptHistoryChat')
  }
  const prompt = aiSnapshot?.prompts.find((item) => item.id === task.promptId)
  return prompt ? aiPromptLabel(prompt, t) : task.title || t('transcript.promptHistoryChat')
}

/**
 * Brand mark of the model behind one result. A run that has not resolved its
 * model yet uses the active provider, which is what it will run on.
 *
 * @param task Agent result.
 * @param aiSnapshot Configured providers, when loaded.
 */
function agentTaskModelIcon(task: AgentTaskActivity, aiSnapshot: AiSettingsSnapshot | null) {
  if (task.model === VIDBEE_CLOUD_MODEL_ID) {
    return aiModelIconComponent({ isCloud: true })
  }
  if (task.model) {
    const provider = aiSnapshot?.providers.find((item) => item.modelId === task.model)
    return aiModelIconComponent({ presetId: provider?.presetId, modelId: task.model })
  }
  const active = aiSnapshot?.providers.find((item) => item.id === aiSnapshot.activeProviderId)
  return active
    ? aiModelIconComponent({ presetId: active.presetId, modelId: active.modelId })
    : aiModelIconComponent({ isCloud: true })
}

/**
 * Overlapping model marks for the Agent results on one video, one chip per
 * distinct model. A chip shows the state of that model's first result (running
 * spins, failed carries a red dot). Clicking opens the first result.
 */
export function AgentTaskIndicator({ tasks, aiSnapshot }: AgentTaskIndicatorProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const first = tasks[0]
  if (!first) {
    return null
  }
  const rows = tasks.map((task) => ({
    task,
    Icon: agentTaskModelIcon(task, aiSnapshot),
    name: agentTaskName(task, aiSnapshot, t),
    status: STATUS_KEY[task.status]
  }))
  const text =
    rows.length === 1 ? rows[0].name : t('download.agentTasks.count', { count: rows.length })
  const summary = t('download.agentTasks.summary', {
    tasks: rows
      .map((row) => `${row.name} ${t(`download.agentTasks.status.${row.status}`)}`)
      .join(', ')
  })
  // Rows are ordered running first, then newest, so the first row per model wins.
  const chips = rows
    .filter((row, index) => rows.findIndex((other) => other.Icon === row.Icon) === index)
    .slice(0, MAX_STACKED_CHIPS)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={summary}
          className="pointer-events-auto relative z-20 inline-flex min-w-0 items-center gap-1.5 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-agent-task-count={rows.length}
          data-testid="download-agent-tasks"
          onClick={(event) => {
            event.stopPropagation()
            void navigate({
              to: '/downloads/$downloadId/transcript',
              params: { downloadId: first.downloadId },
              search: { tab: first.promptId, thread: first.threadId }
            })
          }}
          type="button"
        >
          <span aria-hidden className="inline-flex shrink-0 items-center">
            {chips.map(({ task, Icon, status }, index) => (
              <span
                className={cn(
                  DOWNLOAD_STACK_CHIP_CLASS,
                  index > 0 && '-ml-1',
                  status === 'stopped' && 'opacity-60'
                )}
                data-agent-task-chip={status}
                key={task.threadId}
                style={{ zIndex: chips.length - index }}
              >
                <Icon className="size-3" size={12} />
                {status === 'running' ? (
                  <span className={cn(DOWNLOAD_STACK_BUSY_RING_CLASS, 'text-primary')} />
                ) : null}
                {status === 'failed' ? (
                  <span className="absolute -right-px -bottom-px size-1.5 rounded-full bg-destructive ring-1 ring-background" />
                ) : null}
              </span>
            ))}
          </span>
          <span className="min-w-0 truncate">{text}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left" side="bottom" sideOffset={6}>
        <p className="mb-1 font-medium">{t('download.agentTasks.title')}</p>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
          {rows.map(({ task, Icon, name, status }) => (
            <Fragment key={task.threadId}>
              <Icon aria-hidden className="size-3.5" size={14} />
              <span className="truncate">{name}</span>
              <span className={STATUS_TEXT_CLASS[status]}>
                {t(`download.agentTasks.status.${status}`)}
              </span>
            </Fragment>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
