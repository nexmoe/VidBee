import type { AgentArtifact } from '@shared/agent-chat'
import {
  hasOverviewStructure,
  overviewPlayhead,
  parseOverviewMarkdown
} from '@shared/overview-result'
import { AgentOverview } from '@vidbee/ui/components/agent-overview'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentResponseContent } from './AgentResponseContent'

interface TranscriptOverviewResultProps {
  /** Player current time in milliseconds. */
  currentTimeMs?: number
  /** Media duration in milliseconds; ends the last chapter. */
  durationMs?: number
  markdown: string
  artifacts?: AgentArtifact[]
  ownRunId?: string
  onSeek?: (seconds: number) => void
}

/**
 * Render an Overview as clickable chapters and quotes instead of markdown prose.
 *
 * @param props.currentTimeMs Player current time so the live chapter can follow playback.
 * @param props.durationMs Media duration used as the last chapter end.
 * @param props.markdown Raw Overview prompt result.
 * @param props.onSeek Optional player control; chapters and quotes remain visible without it.
 */
export function TranscriptOverviewResult({
  currentTimeMs = 0,
  durationMs = 0,
  markdown,
  artifacts = [],
  ownRunId,
  onSeek
}: TranscriptOverviewResultProps) {
  const { t } = useTranslation()
  const parsed = useMemo(() => parseOverviewMarkdown(markdown), [markdown])
  const playhead = useMemo(
    () => overviewPlayhead(parsed.chapters, currentTimeMs / 1000, durationMs / 1000),
    [currentTimeMs, durationMs, parsed.chapters]
  )
  if (!hasOverviewStructure(parsed)) {
    return (
      <AgentResponseContent
        artifacts={artifacts}
        onSeek={onSeek}
        ownRunId={ownRunId}
        text={markdown}
      />
    )
  }

  return (
    <AgentOverview
      {...parsed}
      activeIndex={playhead.index}
      labels={{
        chapters: t('transcript.overviewChapters'),
        quotes: t('transcript.overviewQuotes'),
        seek: (clock) => t('transcript.seekAt', { time: clock })
      }}
      onSeek={onSeek}
      progress={playhead.progress}
    />
  )
}
