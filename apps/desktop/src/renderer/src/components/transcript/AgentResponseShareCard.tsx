import { TranscriptCaptionShareCard } from '@renderer/components/transcript/TranscriptCaptionShareCard'
import { TranscriptPromptShareCard } from '@renderer/components/transcript/TranscriptPromptShareCard'
import type { ShareCardPayload } from '@shared/types/share-card'
import type { Ref } from 'react'

interface AgentResponseShareCardProps {
  cardRef?: Ref<HTMLDivElement>
  payload: ShareCardPayload
}

/**
 * Render the share poster the hidden capture window snapshots.
 *
 * @param props.cardRef Root node measured after fonts and images settle.
 * @param props.payload Serializable card props from the visible preview.
 */
export function AgentResponseShareCard({ cardRef, payload }: AgentResponseShareCardProps) {
  if (payload.kind === 'caption') {
    return (
      <TranscriptCaptionShareCard
        cardRef={cardRef}
        coverSrc={payload.coverSrc}
        durationMs={payload.durationMs}
        quote={payload.quote}
        sourceByline={payload.sourceByline}
        sourceTitle={payload.sourceTitle}
        tagline={payload.tagline}
      />
    )
  }
  return (
    <TranscriptPromptShareCard
      artifacts={payload.artifacts}
      cardRef={cardRef}
      coverSrc={payload.coverSrc}
      markdown={payload.markdown}
      runId={payload.runId}
      sourceByline={payload.sourceByline}
      sourceTitle={payload.sourceTitle}
      tagline={payload.tagline}
      userText={payload.userText}
    />
  )
}
