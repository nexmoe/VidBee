import { TranscriptShareCardChrome } from '@renderer/components/transcript/TranscriptShareCardChrome'
import type { AgentArtifact } from '@shared/agent-chat'
import { Brain } from 'lucide-react'
import type { Ref } from 'react'
import { AgentResponseContent } from './AgentResponseContent'

interface TranscriptPromptShareCardProps {
  artifacts?: AgentArtifact[]
  runId?: string
  cardRef?: Ref<HTMLDivElement>
  coverSrc?: string | null
  markdown: string
  sourceByline?: string | null
  sourceTitle?: string | null
  tagline: string
  thinkingLabel?: string
  userText?: string | null
}

/**
 * Prompt share card with a solid background sampled from the cover.
 *
 * @param props.cardRef Root node measured after fonts and images settle.
 * @param props.coverSrc Cover URL used for the header thumb and fill color.
 * @param props.markdown Prompt result markdown.
 * @param props.sourceByline Platform and channel under the title.
 * @param props.sourceTitle Media title in the header.
 * @param props.tagline One-line VidBee intro in the footer.
 * @param props.thinkingLabel Finished thinking duration. Omitted when the run has none.
 * @param props.userText User-sent instruction that produced this reply.
 */
export function TranscriptPromptShareCard({
  artifacts,
  runId,
  cardRef,
  coverSrc,
  markdown,
  sourceByline,
  sourceTitle,
  tagline,
  thinkingLabel,
  userText
}: TranscriptPromptShareCardProps) {
  return (
    <TranscriptShareCardChrome
      cardRef={cardRef}
      coverSrc={coverSrc}
      sourceByline={sourceByline}
      sourceTitle={sourceTitle}
      tagline={tagline}
      testId="transcript-prompt-share-card"
      variant="fill"
    >
      <div className="transcript-prompt-share-scale">
        {userText ? (
          <div className="mb-6 flex justify-end">
            <p
              className="max-w-[80%] whitespace-pre-wrap rounded-3xl bg-white/14 px-4 py-2.5 text-sm text-white/90 leading-relaxed"
              data-testid="transcript-share-card-user-text"
              dir="auto"
            >
              {userText}
            </p>
          </div>
        ) : null}
        {thinkingLabel ? (
          <p
            className="mb-4 flex items-center gap-1.5 text-sm text-white/70 leading-snug"
            data-testid="transcript-share-card-thinking"
            dir="auto"
          >
            <Brain aria-hidden className="size-3.5 shrink-0" />
            <span>{thinkingLabel}</span>
          </p>
        ) : null}
        <div className="text-white [&_*]:text-white">
          <AgentResponseContent
            artifacts={artifacts ?? []}
            ownRunId={runId}
            share
            text={markdown}
          />
        </div>
      </div>
    </TranscriptShareCardChrome>
  )
}
