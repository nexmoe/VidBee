'use client'

import { Captions, CaptionsOff, type LucideIcon, Music, Video } from 'lucide-react'
import { Fragment } from 'react'
import { cn } from '../../lib/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

export type DownloadContentKind = 'audio' | 'subtitles' | 'video'

/** `busy` is still being produced; `warning` and `danger` were attempted but are missing. */
export type DownloadContentState = 'busy' | 'danger' | 'ready' | 'warning'

export interface DownloadContentPart {
  detail?: string
  kind: DownloadContentKind
  label: string
  state: DownloadContentState
}

/** Chips are 18px tall, so the surrounding line must be at least that high. */
interface DownloadContentStackProps {
  className?: string
  /** Muted tooltip lines that explain content which is absent, such as subtitles. */
  notes?: string[]
  /** Media first, then subtitles; earlier parts overlap later ones. */
  parts: DownloadContentPart[]
}

/** Shared round chip used by every overlapping stack on a download row. */
export const DOWNLOAD_STACK_CHIP_CLASS =
  'relative inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border border-background bg-[color-mix(in_oklab,var(--muted)_55%,var(--background))]'

/** Spinning ring drawn over a chip whose work is still running. */
export const DOWNLOAD_STACK_BUSY_RING_CLASS =
  'absolute -inset-px rounded-full border-[1.5px] border-transparent border-t-current motion-safe:animate-spin'

const STATE_CLASS: Record<DownloadContentState, string> = {
  busy: 'text-foreground',
  danger: 'text-destructive',
  ready: 'text-foreground',
  warning: 'text-amber-600 dark:text-amber-400'
}

/**
 * Icon for one content part; missing subtitles use the crossed-out caption mark.
 */
const contentIcon = (part: DownloadContentPart): LucideIcon => {
  if (part.kind === 'video') {
    return Video
  }
  if (part.kind === 'audio') {
    return Music
  }
  return part.state === 'danger' || part.state === 'warning' ? CaptionsOff : Captions
}

/**
 * Overlapping chips for what one download holds, with a single tooltip that
 * lists every part and explains anything that is missing.
 */
export const DownloadContentStack = ({
  className,
  notes = [],
  parts
}: DownloadContentStackProps) => {
  if (parts.length === 0) {
    return null
  }
  const summary = [
    ...parts.map((part) => (part.detail ? `${part.label}: ${part.detail}` : part.label)),
    ...notes
  ].join('; ')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={summary}
          className={cn('pointer-events-auto inline-flex shrink-0 items-center', className)}
          data-testid="download-content-stack"
          role="img"
        >
          {parts.map((part, index) => {
            const Icon = contentIcon(part)
            return (
              <span
                className={cn(
                  DOWNLOAD_STACK_CHIP_CLASS,
                  index > 0 && '-ml-1',
                  STATE_CLASS[part.state]
                )}
                data-content-kind={part.kind}
                data-content-state={part.state}
                key={part.kind}
                style={{ zIndex: parts.length - index }}
              >
                <Icon aria-hidden className="size-3" />
                {part.state === 'busy' ? (
                  <span aria-hidden className={DOWNLOAD_STACK_BUSY_RING_CLASS} />
                ) : null}
              </span>
            )
          })}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left" side="bottom" sideOffset={6}>
        <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-1.5 gap-y-1">
          {parts.map((part) => {
            const Icon = contentIcon(part)
            return (
              <Fragment key={part.kind}>
                <Icon aria-hidden className="size-3.5 opacity-80" />
                <span className="font-medium">{part.label}</span>
                <span className="opacity-70">{part.detail}</span>
              </Fragment>
            )
          })}
        </div>
        {notes.length > 0 ? (
          <div className="mt-1.5 space-y-0.5 opacity-70">
            {notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}
