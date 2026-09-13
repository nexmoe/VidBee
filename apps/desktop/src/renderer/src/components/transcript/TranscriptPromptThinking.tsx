import { thinkingDurationHeader } from '@renderer/lib/thinking-header'
import { parseThinkingSteps } from '@shared/ai-thinking'
import type { AiPromptRunSnapshot } from '@shared/ai-types'
import {
  ThinkingStep,
  ThinkingSteps,
  ThinkingStepsContent,
  ThinkingStepsHeader
} from '@vidbee/ui/components/ui/thinking-steps'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface TranscriptPromptThinkingProps {
  running: boolean
  waitingSince?: number
  recovery?: AiPromptRunSnapshot['recovery']
  keepOpen?: boolean
  thinking: string
  thinkingMs: number
}

interface ThinkingRow {
  description?: string
  isLast: boolean
  label: string
  status: 'active' | 'complete'
}

/**
 * Build the step rows shown while a prompt is thinking or after it finishes.
 *
 * @param thinking Raw reasoning text from the model.
 * @param running Whether the run is still streaming.
 * @param writingLabel Placeholder label used before any thinking arrives.
 */
const thinkingRows = (thinking: string, running: boolean, writingLabel: string): ThinkingRow[] => {
  const parsed = parseThinkingSteps(thinking)
  if (parsed.length === 0) {
    if (!running) {
      return []
    }
    return [{ isLast: true, label: writingLabel, status: 'active' }]
  }
  return parsed.map((step, index) => ({
    description: step.description,
    isLast: index === parsed.length - 1,
    label: step.label,
    status: running && index === parsed.length - 1 ? 'active' : 'complete'
  }))
}

/**
 * Render model reasoning as collapsible steps instead of raw Streamdown.
 *
 * @param props Live thinking text, its duration, and whether the run streams.
 */
export function TranscriptPromptThinking({
  running,
  waitingSince,
  recovery,
  keepOpen = false,
  thinking,
  thinkingMs
}: TranscriptPromptThinkingProps) {
  const { t } = useTranslation()
  const [now, setNow] = useState(Date.now)
  const waiting = running && waitingSince !== undefined && !recovery
  useEffect(() => {
    if (!waiting) {
      return
    }
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [waiting])
  const waitingLabel = t('transcript.promptWaiting', {
    seconds: Math.max(0, Math.floor((now - (waitingSince ?? now)) / 1000))
  })
  const recovering = running && recovery
  const recoveryLabel = recovering ? t('transcript.promptRetrying', recovery) : ''
  const rows = recovering
    ? [
        {
          isLast: true,
          label: recoveryLabel,
          description: recovery.error,
          status: 'active' as const
        }
      ]
    : thinkingRows(thinking, running, waiting ? waitingLabel : t('transcript.promptRunning'))
  if (rows.length === 0) {
    return null
  }

  // Runs recorded before the duration was tracked keep the plain label rather
  // than claiming zero seconds.
  let header = waiting ? waitingLabel : t('transcript.promptThinking')
  if (thinkingMs > 0) {
    header = thinkingDurationHeader(t, running, thinkingMs)
  }

  if (recovering) {
    header = recoveryLabel
  }

  return (
    <ThinkingSteps
      className="w-full font-sans"
      data-testid="transcript-prompt-thinking"
      defaultOpen={running || keepOpen}
      key={`${running}:${keepOpen}`}
    >
      <ThinkingStepsHeader icon="brain">{header}</ThinkingStepsHeader>
      <ThinkingStepsContent>
        {rows.map((row, index) => (
          <ThinkingStep
            description={row.description}
            isLast={row.isLast}
            key={`${String(index)}:${row.label}`}
            label={row.label}
            showIcon={false}
            status={row.status}
          />
        ))}
      </ThinkingStepsContent>
    </ThinkingSteps>
  )
}
