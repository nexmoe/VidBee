import { SHARE_CARD_LOGO_SRC } from '@renderer/components/transcript/share-card-logo'
import { RemoteImage } from '@renderer/components/ui/remote-image'
import { SHARE_CARD_WASH, useCoverFillColor } from '@renderer/lib/share-card-fill'
import { SHARE_CARD_WIDTH } from '@shared/types/share-card'
import type { CSSProperties, ReactNode, Ref } from 'react'

export { SHARE_CARD_WASH, SHARE_CARD_WIDTH }

export const SHARE_CARD_THEME = {
  colorScheme: 'dark',
  backgroundColor: SHARE_CARD_WASH,
  color: '#ffffff',
  '--background': SHARE_CARD_WASH,
  '--foreground': '#ffffff',
  '--card': SHARE_CARD_WASH,
  '--card-foreground': '#ffffff',
  '--muted': '#44403c',
  '--muted-foreground': 'rgba(255,255,255,0.55)',
  '--border': 'rgba(255,255,255,0.2)',
  '--primary': '#ffffff',
  '--sidebar': SHARE_CARD_WASH
} as CSSProperties

const COVER_FALLBACK = SHARE_CARD_LOGO_SRC

interface TranscriptShareCardChromeProps {
  cardRef?: Ref<HTMLDivElement>
  children: ReactNode
  coverSrc?: string | null
  durationLabel?: string
  progressRatio?: number
  sourceByline?: string | null
  sourceTitle?: string | null
  startLabel?: string
  tagline: string
  testId?: string
  variant?: 'fill' | 'poster'
}

/**
 * Build inline theme tokens, overriding the wash when the cover was sampled.
 *
 * @param fillColor Solid background sampled from the cover, or the default wash.
 */
const shareCardTheme = (fillColor: string): CSSProperties & Record<`--${string}`, string> => ({
  ...SHARE_CARD_THEME,
  backgroundColor: fillColor,
  '--background': fillColor,
  '--card': fillColor,
  '--sidebar': fillColor
})

/**
 * Poster or cover-fill chrome the hidden capture window snapshots as a PNG.
 *
 * @param props.cardRef Root node measured after fonts and images settle.
 * @param props.children Quote or prompt body.
 * @param props.coverSrc Cover URL; RemoteImage caches remote hosts for CSP.
 * @param props.durationLabel Total duration on the progress bar.
 * @param props.progressRatio Fill from 0 to 1 for the quote start.
 * @param props.sourceByline Platform and channel under the title.
 * @param props.sourceTitle Media title in the header.
 * @param props.startLabel Quote start time on the progress bar.
 * @param props.testId Optional test id on the captured root.
 * @param props.variant `poster` blurs the cover; `fill` uses a solid cover color.
 */
export function TranscriptShareCardChrome({
  cardRef,
  children,
  coverSrc,
  durationLabel,
  progressRatio,
  sourceByline,
  sourceTitle,
  startLabel,
  testId,
  variant = 'poster'
}: TranscriptShareCardChromeProps) {
  const title = sourceTitle?.trim() || ''
  const byline = sourceByline?.trim() || ''
  const cover = coverSrc?.trim() || COVER_FALLBACK
  const ratio = progressRatio === undefined ? null : Math.min(1, Math.max(0, progressRatio))
  const showProgress = Boolean(startLabel && durationLabel)
  const isPoster = variant === 'poster'
  const fill = useCoverFillColor(isPoster ? null : coverSrc)
  return (
    <div
      className="relative box-border overflow-hidden text-white"
      data-share-fill={isPoster ? undefined : fill.ready ? 'ready' : 'pending'}
      data-testid={testId}
      ref={cardRef}
      style={{
        ...shareCardTheme(isPoster ? SHARE_CARD_WASH : fill.color),
        width: SHARE_CARD_WIDTH
      }}
    >
      {isPoster ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="size-full origin-center scale-[2.2]"
            style={{ filter: 'blur(18px) saturate(1.32) brightness(1.12)' }}
          >
            <RemoteImage alt="" className="h-full w-full object-cover" src={cover} />
          </div>
          <div className="absolute inset-0 bg-[#e09a70]/34" />
          <div className="absolute inset-0 bg-black/12" />
        </div>
      ) : null}
      <div className="relative flex flex-col gap-8 px-8 py-9">
        <header className="flex items-center gap-5">
          <div
            className="h-[72px] w-fit shrink-0 overflow-hidden rounded-[3px] bg-black/20 shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
            data-testid="transcript-share-card-cover"
          >
            <RemoteImage
              alt={title || 'VidBee'}
              className="h-full w-auto"
              imgClassName="block h-full w-auto object-contain"
              src={cover}
            />
          </div>
          {title || byline ? (
            <div className="min-w-0 flex-1 overflow-hidden">
              {title ? (
                <p className="line-clamp-2 font-semibold text-[18px] leading-snug">{title}</p>
              ) : null}
              {byline ? (
                <p
                  className="mt-1 truncate text-[13px] text-white/65 leading-snug"
                  data-testid="transcript-share-card-byline"
                >
                  {byline}
                </p>
              ) : null}
            </div>
          ) : null}
        </header>
        <div>{children}</div>
        {showProgress ? (
          <div>
            <div className="mb-2 flex items-center justify-between text-[13px] text-white tabular-nums">
              <span>{startLabel}</span>
              <span>{durationLabel}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/30">
              <div
                className="h-full rounded-full bg-white"
                style={{ width: `${Math.round((ratio ?? 0) * 1000) / 10}%` }}
              />
            </div>
          </div>
        ) : null}
        <footer
          className="relative flex items-center justify-center gap-2 whitespace-nowrap pt-5 text-[20px] leading-none before:absolute before:top-0 before:left-1/2 before:h-px before:w-12 before:-translate-x-1/2 before:bg-white/30"
          data-testid="transcript-share-card-footer"
        >
          <span className="text-white/65">Made with</span>
          <img
            alt=""
            className="block size-7 shrink-0 rounded"
            height={28}
            src={SHARE_CARD_LOGO_SRC}
            width={28}
          />
          <span className="font-semibold text-white/85">VidBee</span>
        </footer>
      </div>
    </div>
  )
}
