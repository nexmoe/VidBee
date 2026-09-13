import { Button } from '@renderer/components/ui/button'
import { Response } from '@renderer/components/ui/response'
import { ipcServices } from '@renderer/lib/ipc'
import type { AgentArtifact } from '@shared/agent-chat'
import { ARTIFACT_REFERENCE, splitAgentResponseMedia } from '@shared/agent-markdown'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle
} from '@vidbee/ui/components/ui/attachment'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export { ARTIFACT_REFERENCE }

/** Resolve an opaque artifact URL; main-process ownership checks enforce access. */
export function agentArtifactUrl(
  artifact: Pick<AgentArtifact, 'threadId' | 'id'>,
  poster = false
): string {
  return `agent-artifact://${artifact.threadId}/${artifact.id}${poster ? '?poster=1' : ''}`
}

/** Format a source timestamp without losing its connection to the full video timeline. */
function clock(seconds: number): string {
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Render an attachment from a validated product record, with independent playback and export controls. */
function AgentAttachment({
  artifact,
  caption,
  share,
  onSeek
}: {
  artifact: AgentArtifact
  caption: string
  share?: boolean
  onSeek?: (seconds: number) => void
}) {
  const { t } = useTranslation()
  /** Export only this attachment through the native save dialog. */
  async function save(): Promise<void> {
    try {
      await ipcServices.ai.saveAgentArtifact({
        threadId: artifact.threadId,
        artifactId: artifact.id
      })
    } catch {
      toast.error(t('agentChat.attachmentUnavailable'))
    }
  }
  const label =
    caption ||
    t(artifact.kind === 'image' ? 'agentChat.frame' : 'agentChat.clip', {
      time: clock(artifact.start)
    })
  return (
    <Attachment
      className="my-4 w-full max-w-full gap-2 rounded-none border-0 bg-transparent has-data-[slot=attachment-content]:w-full has-data-[slot=attachment-media]:p-0 has-data-[slot=attachment-content]:px-0 has-data-[slot=attachment-content]:py-0"
      orientation="vertical"
    >
      <AttachmentMedia
        className="aspect-auto w-full rounded-sm bg-transparent *:[img]:aspect-auto *:[img]:object-contain"
        variant="image"
      >
        {artifact.kind === 'video' && !share ? (
          // biome-ignore lint/a11y/useMediaCaption: This is a user-requested source excerpt; the adjacent timestamp links to the full transcript.
          <video
            aria-label={label}
            className="aspect-video w-full rounded-sm"
            controls
            playsInline
            poster={agentArtifactUrl(artifact, true)}
            preload="metadata"
            src={agentArtifactUrl(artifact)}
          />
        ) : (
          <img
            alt={label}
            className="h-auto w-full rounded-sm object-contain"
            src={agentArtifactUrl(artifact, artifact.kind === 'video')}
            style={
              artifact.width && artifact.height
                ? { aspectRatio: `${artifact.width} / ${artifact.height}` }
                : undefined
            }
          />
        )}
      </AttachmentMedia>
      <div className="flex w-full items-center gap-3">
        <AttachmentContent className="flex items-center gap-2 group-data-[orientation=vertical]/attachment:px-0">
          <AttachmentTitle className="font-normal text-muted-foreground text-xs" title={label}>
            {label}
          </AttachmentTitle>
          <AttachmentDescription className="mt-0 shrink-0">
            {!share && onSeek ? (
              <Button
                className="h-auto p-0 text-xs"
                onClick={() => onSeek(artifact.start)}
                variant="link"
              >
                {clock(artifact.start)}
                {artifact.end ? `–${clock(artifact.end)}` : ''}
              </Button>
            ) : (
              `${clock(artifact.start)}${artifact.end ? `–${clock(artifact.end)}` : ''}`
            )}
          </AttachmentDescription>
        </AttachmentContent>
        {share ? null : (
          <AttachmentActions className="group-data-[orientation=vertical]/attachment:static">
            <AttachmentAction
              aria-label={t('agentChat.saveAttachment')}
              className="size-7 rounded-sm text-muted-foreground"
              onClick={() => void save()}
            >
              <Download />
            </AttachmentAction>
          </AttachmentActions>
        )}
      </div>
    </Attachment>
  )
}

/** Render verified artifact references inline and retain unreferenced outputs below the answer. */
export function AgentResponseContent({
  text,
  artifacts,
  ownRunId,
  running = false,
  share = false,
  onSeek
}: {
  text: string
  artifacts: AgentArtifact[]
  ownRunId?: string
  running?: boolean
  share?: boolean
  onSeek?: (seconds: number) => void
}) {
  const parts = splitAgentResponseMedia(text, artifacts, ownRunId, !running)
  return (
    <>
      {parts.map((part) =>
        part.artifact ? (
          <AgentAttachment
            artifact={part.artifact}
            caption={part.caption ?? ''}
            key={part.key}
            onSeek={onSeek}
            share={share}
          />
        ) : (
          <Response
            className="transcript-prompt-markdown"
            controls={!share}
            isAnimating={running}
            key={part.key}
            mode={running ? 'streaming' : 'static'}
            onSeek={onSeek}
          >
            {part.text ?? ''}
          </Response>
        )
      )}
    </>
  )
}
