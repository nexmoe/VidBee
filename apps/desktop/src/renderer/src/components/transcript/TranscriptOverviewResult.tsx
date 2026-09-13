import { cn } from '@renderer/lib/utils'
import type { AgentArtifact } from '@shared/agent-chat'
import {
  hasOverviewStructure,
  overviewPlayhead,
  parseOverviewMarkdown
} from '@shared/overview-result'
import { useEffect, useMemo, useRef } from 'react'
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
  onSeek: (seconds: number) => void
}

/**
 * Render an Overview as clickable chapters and quotes instead of markdown prose.
 *
 * @param props.currentTimeMs Player current time so the live chapter can follow playback.
 * @param props.durationMs Media duration used as the last chapter end.
 * @param props.markdown Raw Overview prompt result.
 * @param props.onSeek Seek the player to this many seconds.
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
  const activeChapterRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (playhead.index < 0) {
      return
    }
    const node = activeChapterRef.current
    if (!node || typeof node.scrollIntoView !== 'function') {
      return
    }
    node.scrollIntoView({ block: 'nearest' })
  }, [playhead.index])
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
    <div className="flex flex-col gap-5" data-testid="transcript-overview-result">
      {parsed.takeaway ? (
        <p className="text-[0.9375rem] leading-relaxed [overflow-wrap:anywhere]">
          {parsed.takeaway}
        </p>
      ) : null}
      {parsed.chapters.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <h2 className="font-medium text-muted-foreground text-xs">
            {t('transcript.overviewChapters')}
          </h2>
          <ul className="flex flex-col">
            {parsed.chapters.map((chapter, index) => {
              const active = index === playhead.index
              return (
                <li key={`${chapter.clock}-${chapter.title}-${chapter.summary}`}>
                  <button
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'relative flex w-full items-start gap-3 overflow-hidden rounded-md px-2 py-2 text-left',
                      active ? 'bg-muted/50' : 'hover:bg-muted/60 active:bg-muted'
                    )}
                    onClick={() => onSeek(chapter.seconds)}
                    ref={active ? activeChapterRef : undefined}
                    title={t('transcript.seekAt', { time: chapter.clock })}
                    type="button"
                  >
                    {active ? (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 origin-left bg-primary/10"
                        data-testid="overview-chapter-progress"
                        style={{ transform: `scaleX(${playhead.progress})` }}
                      />
                    ) : null}
                    <span className="relative mt-0.5 shrink-0 font-medium text-primary text-xs tabular-nums">
                      {chapter.clock}
                    </span>
                    <span className="relative min-w-0">
                      <span className="block font-medium text-sm [overflow-wrap:anywhere]">
                        {chapter.title}
                      </span>
                      {chapter.summary ? (
                        <span className="mt-0.5 block text-muted-foreground text-xs leading-relaxed [overflow-wrap:anywhere]">
                          {chapter.summary}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
      {parsed.quotes.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium text-muted-foreground text-xs">
            {t('transcript.overviewQuotes')}
          </h2>
          <ul className="flex flex-col gap-2">
            {parsed.quotes.map((quote) => (
              <li key={`${quote.clock}-${quote.quote}`}>
                <button
                  className={cn(
                    'flex w-full flex-col gap-2 rounded-md border-primary/50 border-l-2 bg-muted/40 px-3 py-2.5 text-left',
                    'hover:bg-muted/70 active:bg-muted'
                  )}
                  onClick={() => onSeek(quote.seconds)}
                  title={t('transcript.seekAt', { time: quote.clock })}
                  type="button"
                >
                  <span className="text-sm leading-relaxed [overflow-wrap:anywhere]">
                    {quote.quote}
                  </span>
                  <span className="font-medium text-primary text-xs tabular-nums">
                    {quote.clock}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
