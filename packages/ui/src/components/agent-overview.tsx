import { useEffect, useRef } from 'react'
import { cn } from '../lib/cn'

/** Keep the chapter and quote layout visible even when source playback is unavailable. */
export function AgentOverview({
  takeaway,
  chapters,
  quotes,
  activeIndex,
  progress,
  labels,
  onSeek
}: {
  takeaway: string
  chapters: { clock: string; seconds: number; title: string; summary: string }[]
  quotes: { clock: string; seconds: number; quote: string }[]
  activeIndex: number
  progress: number
  labels: { chapters: string; quotes: string; seek: (clock: string) => string }
  onSeek?: (seconds: number) => void
}) {
  const activeChapter = useRef<HTMLButtonElement>(null)
  const currentIndex = onSeek ? activeIndex : -1
  useEffect(() => {
    if (currentIndex >= 0) {
      activeChapter.current?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [currentIndex])
  return (
    <div className="flex flex-col gap-5" data-testid="transcript-overview-result">
      {takeaway ? (
        <p className="text-[0.9375rem] leading-relaxed [overflow-wrap:anywhere]">{takeaway}</p>
      ) : null}
      {chapters.length ? (
        <section className="flex flex-col gap-1.5">
          <h2 className="font-medium text-muted-foreground text-xs">{labels.chapters}</h2>
          <ul className="flex flex-col">
            {chapters.map((chapter, index) => (
              <li key={`${chapter.clock}-${chapter.title}-${chapter.summary}`}>
                <button
                  aria-current={index === currentIndex ? 'true' : undefined}
                  className={cn(
                    'relative flex w-full items-start gap-3 overflow-hidden rounded-md px-2 py-2 text-left disabled:cursor-default',
                    index === currentIndex
                      ? 'bg-muted/50'
                      : 'enabled:hover:bg-muted/60 enabled:active:bg-muted'
                  )}
                  disabled={!onSeek}
                  onClick={() => onSeek?.(chapter.seconds)}
                  ref={index === currentIndex ? activeChapter : undefined}
                  title={onSeek ? labels.seek(chapter.clock) : undefined}
                  type="button"
                >
                  {index === currentIndex ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 origin-left bg-primary/10"
                      data-testid="overview-chapter-progress"
                      style={{ transform: `scaleX(${progress})` }}
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
            ))}
          </ul>
        </section>
      ) : null}
      {quotes.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium text-muted-foreground text-xs">{labels.quotes}</h2>
          <ul className="flex flex-col gap-2">
            {quotes.map((quote) => (
              <li key={`${quote.clock}-${quote.quote}`}>
                <button
                  className="flex w-full flex-col gap-2 rounded-md border-primary/50 border-l-2 bg-muted/40 px-3 py-2.5 text-left enabled:hover:bg-muted/70 enabled:active:bg-muted disabled:cursor-default"
                  disabled={!onSeek}
                  onClick={() => onSeek?.(quote.seconds)}
                  title={onSeek ? labels.seek(quote.clock) : undefined}
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
