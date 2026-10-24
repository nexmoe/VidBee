import { AgentResponseShareCard } from '@renderer/components/transcript/AgentResponseShareCard'
import { SHARE_CARD_WASH } from '@renderer/components/transcript/TranscriptShareCardChrome'
import { RemoteImageProvider } from '@renderer/components/ui/remote-image'
import { waitForShareCard } from '@renderer/lib/capture-prompt-share'
import { measureShareImageLayout } from '@renderer/lib/share-image-layout'
import { MERMAID_EXPORT_CHANNEL, type MermaidExportPayload } from '@shared/types/mermaid-export'
import {
  SHARE_CAPTURE_READY_CHANNEL,
  SHARE_CAPTURE_RENDER_CHANNEL,
  type ShareCaptureReadyMessage,
  type ShareCaptureRenderMessage,
  type ShareCardPayload
} from '@shared/types/share-card'
import { ThemeProvider } from 'next-themes'
import { useEffect, useRef, useState } from 'react'

/**
 * Hidden-window page that paints one share card and reports its box to main.
 */
export function ShareCapturePage() {
  const cardRef = useRef<HTMLDivElement>(null)
  const [requestId, setRequestId] = useState<number | null>(null)
  const [payload, setPayload] = useState<ShareCardPayload | null>(null)

  useEffect(() => {
    document.documentElement.style.background = SHARE_CARD_WASH
    document.body.style.margin = '0'
    document.body.style.overflow = 'visible'
    document.body.style.background = SHARE_CARD_WASH
  }, [])

  useEffect(() => {
    /**
     * Replace the painted card when main asks for a new snapshot.
     *
     * @param args IPC args; the first value is the render message.
     */
    const onRender = (...args: unknown[]): void => {
      const message = args[0] as ShareCaptureRenderMessage
      setRequestId(message.requestId)
      setPayload(message.payload)
    }
    window.api.on(SHARE_CAPTURE_RENDER_CHANNEL, onRender)
    /** Export diagram bytes through the same private window without creating a share card. */
    const onMermaidExport = (...args: unknown[]): void => {
      const message = args[0] as { payload: MermaidExportPayload; requestId: number }
      void import('@renderer/lib/mermaid-export')
        .then(({ renderMermaidExport }) => renderMermaidExport(message.payload))
        .then((diagram) => {
          window.api.send(SHARE_CAPTURE_READY_CHANNEL, {
            requestId: message.requestId,
            width: diagram.width,
            height: diagram.height,
            diagram
          } satisfies ShareCaptureReadyMessage)
        })
        .catch((error: unknown) => {
          window.api.send(SHARE_CAPTURE_READY_CHANNEL, {
            requestId: message.requestId,
            width: 0,
            height: 0,
            error: error instanceof Error ? error.message : String(error)
          } satisfies ShareCaptureReadyMessage)
        })
    }
    const mermaidSubscription = window.api.on(MERMAID_EXPORT_CHANNEL, onMermaidExport)
    window.api.send(SHARE_CAPTURE_READY_CHANNEL, { requestId: 0, width: 0, height: 0 })
    return () => {
      window.api.removeListener(SHARE_CAPTURE_RENDER_CHANNEL, onRender)
      window.api.removeListener(MERMAID_EXPORT_CHANNEL, mermaidSubscription)
    }
  }, [])

  useEffect(() => {
    if (requestId == null || !payload) {
      return
    }
    const node = cardRef.current
    if (!node) {
      return
    }
    let cancelled = false
    void (async () => {
      await waitForShareCard(node)
      if (cancelled) {
        return
      }
      const rect = node.getBoundingClientRect()
      const ready: ShareCaptureReadyMessage = {
        height: Math.ceil(rect.height),
        layout: measureShareImageLayout(node),
        requestId,
        width: Math.ceil(rect.width)
      }
      window.api.send(SHARE_CAPTURE_READY_CHANNEL, ready)
    })()
    return () => {
      cancelled = true
    }
  }, [payload, requestId])

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <RemoteImageProvider>
        <div data-share-capture-stage="" style={{ overflow: 'hidden' }}>
          {/* Offscreen windows use a 1x display scale; retain a sharp 2x export locally. */}
          <div style={{ zoom: 2 }}>
            {payload ? <AgentResponseShareCard cardRef={cardRef} payload={payload} /> : null}
          </div>
        </div>
      </RemoteImageProvider>
    </ThemeProvider>
  )
}
