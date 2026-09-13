import { TranscriptShareCardChrome } from '@renderer/components/transcript/TranscriptShareCardChrome'
import { formatShareClock } from '@renderer/lib/format-clock'
import type { CaptionShareQuote } from '@renderer/lib/transcript-caption-selection'
import type { Ref } from 'react'

interface TranscriptCaptionShareCardProps {
  cardRef?: Ref<HTMLDivElement>
  coverSrc?: string | null
  durationMs?: number
  quote: CaptionShareQuote
  sourceByline?: string | null
  sourceTitle?: string | null
  tagline: string
}

/**
 * Poster share card for a selected transcript quote.
 *
 * @param props.cardRef Root node measured after fonts and images settle.
 * @param props.coverSrc Cover URL; RemoteImage caches remote hosts for CSP.
 * @param props.durationMs Media duration for the progress bar.
 * @param props.quote Selected text plus neighboring context.
 * @param props.sourceByline Platform and channel under the title.
 * @param props.sourceTitle Media title in the header.
 * @param props.tagline One-line VidBee intro in the footer.
 */
export function TranscriptCaptionShareCard({
  cardRef,
  coverSrc,
  durationMs = 0,
  quote,
  sourceByline,
  sourceTitle,
  tagline
}: TranscriptCaptionShareCardProps) {
  const durationSeconds = durationMs > 0 ? durationMs / 1000 : 0
  const progressRatio = durationMs > 0 ? quote.startMs / durationMs : undefined
  const quoteLines = quote.quote
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return (
    <TranscriptShareCardChrome
      cardRef={cardRef}
      coverSrc={coverSrc}
      durationLabel={durationSeconds > 0 ? formatShareClock(durationSeconds) : undefined}
      progressRatio={progressRatio}
      sourceByline={sourceByline}
      sourceTitle={sourceTitle}
      startLabel={formatShareClock(quote.startMs / 1000)}
      tagline={tagline}
      testId="transcript-caption-share-card"
    >
      <div className="space-y-4">
        {quote.before ? (
          <p className="whitespace-pre-wrap text-[24px] text-white/40 leading-[1.6]">
            {quote.before}
          </p>
        ) : null}
        {quoteLines.map((line) => (
          <p
            className="whitespace-pre-wrap font-medium text-[24px] text-white leading-[1.6]"
            key={line}
          >
            {line}
          </p>
        ))}
        {quote.after ? (
          <p className="whitespace-pre-wrap text-[24px] text-white/40 leading-[1.6]">
            {quote.after}
          </p>
        ) : null}
      </div>
    </TranscriptShareCardChrome>
  )
}
