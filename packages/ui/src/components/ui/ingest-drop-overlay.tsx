'use client'

import { FileAudio, Link } from 'lucide-react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import type { HomeIngestDropKind } from '../../lib/use-home-ingest'

interface IngestDropOverlayProps {
  visible: boolean
  kind: HomeIngestDropKind | null
  urlTitle: string
  mediaTitle: string
  mixedTitle: string
  description: string
}

/**
 * Full-window drop hint shown while dragging URLs or media onto VidBee.
 * Portaled to document.body so ancestor backdrop-filter/transform cannot
 * shrink `position: fixed` to the home filter bar.
 */
export const IngestDropOverlay = ({
  visible,
  kind,
  urlTitle,
  mediaTitle,
  mixedTitle,
  description
}: IngestDropOverlayProps) => {
  if (!visible || typeof document === 'undefined') {
    return null
  }

  const title = kind === 'url' ? urlTitle : kind === 'mixed' ? mixedTitle : mediaTitle
  const Icon = kind === 'url' ? Link : FileAudio
  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center bg-background/55 backdrop-blur-xl backdrop-saturate-150"
      data-testid="ingest-drop-overlay"
    >
      <div
        className={cn(
          'flex max-w-md flex-col items-center gap-3 rounded-2xl border-2 border-primary border-dashed bg-background/95 px-10 py-8 text-center shadow-lg'
        )}
      >
        <Icon aria-hidden="true" className="h-10 w-10 text-primary" />
        <p className="font-medium text-foreground text-lg">{title}</p>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
    </div>,
    document.body
  )
}
