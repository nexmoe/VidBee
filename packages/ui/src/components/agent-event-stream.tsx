import { type ReactNode, useEffect, useRef, useState } from 'react'
import type {
  AgentActivity,
  AgentThinkingArtifact as AgentArtifact,
  AgentThinkingMessage as AgentChatMessage,
  AgentThinkingRun as AgentChatRun
} from '../lib/agent-activity'
import { thinkingDurationHeader } from '../lib/thinking-header'
import { AgentThinkingContent } from './agent-thinking-content'
import { Button } from './ui/button'
import {
  ThinkingStep,
  ThinkingStepImage,
  ThinkingStepSource,
  ThinkingStepSources,
  ThinkingSteps,
  ThinkingStepsHeader
} from './ui/thinking-steps'

const toolIcons = {
  get_video_info: 'monitor',
  read_transcript: 'square-library',
  search_transcript: 'search',
  capture_frames: 'image',
  create_clip: 'play',
  read_history: 'square-library',
  search_history: 'search',
  read_notes: 'square-library',
  write_notes: 'square-library',
  read_artifact: 'image'
} as const

/** Keep one stable row per reasoning block as streamed paragraphs grow. */
export function eventRows(message: AgentChatMessage, run?: AgentChatRun): AgentActivity[] {
  const activity = run?.activity?.length
    ? run.activity
    : (run?.tools.map((tool) => ({
        id: tool.id,
        kind: 'tool' as const,
        toolId: tool.id,
        name: tool.name,
        artifactIds: []
      })) ?? [])
  const hasThinking = activity.some((event) => event.kind === 'thinking' && event.text.trim())
  const events: AgentActivity[] =
    !hasThinking && message.thinking.trim()
      ? [{ id: 'thinking', kind: 'thinking', text: message.thinking }, ...activity]
      : activity
  return events.flatMap((event) => {
    if (event.kind !== 'thinking') {
      return [event]
    }
    const text = event.text.trim()
    return text ? [{ ...event, id: `${event.id}:0`, text }] : []
  })
}

/** Format a tool artifact's source timestamp for an inline video link. */
function timestamp(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`
}

/** Clock range shown on a captured frame, clip, or source pill. */
function artifactClock(artifact: AgentArtifact): string {
  return `${timestamp(artifact.start)}${artifact.end === undefined ? '' : `–${timestamp(artifact.end)}`}`
}

/** Opaque renderer URL for a stored artifact. */
function artifactUrl(artifact: AgentArtifact, poster = false): string {
  return `agent-artifact://${artifact.threadId}/${artifact.id}${poster ? '?poster=1' : ''}`
}

/** Official thinking-step media: images with captions, otherwise source pills. */
function EventImage({
  artifact,
  delay,
  onSeek
}: {
  artifact: AgentArtifact
  delay: number
  onSeek?: (seconds: number) => void
}) {
  const caption = artifactClock(artifact)
  const image = (
    <ThinkingStepImage
      alt={caption}
      caption={caption}
      delay={delay}
      src={artifactUrl(artifact, artifact.kind === 'video')}
    />
  )
  return onSeek ? (
    <button
      className="w-fit max-w-full cursor-pointer border-0 bg-transparent p-0 text-left"
      onClick={() => onSeek(artifact.start)}
      type="button"
    >
      {image}
    </button>
  ) : (
    image
  )
}

function EventSource({
  artifact,
  delay,
  onSeek
}: {
  artifact: AgentArtifact
  delay: number
  onSeek?: (seconds: number) => void
}) {
  const label = artifactClock(artifact)
  const pill = (
    <ThinkingStepSource delay={delay}>{onSeek ? `${label} ↗` : label}</ThinkingStepSource>
  )
  return onSeek ? (
    <button
      className="cursor-pointer border-0 bg-transparent p-0"
      onClick={() => onSeek(artifact.start)}
      type="button"
    >
      {pill}
    </button>
  ) : (
    pill
  )
}

function EventMedia({
  artifacts,
  ids,
  onSeek,
  renderMedia
}: {
  artifacts: AgentArtifact[]
  ids: string[]
  onSeek?: (seconds: number) => void
  renderMedia?: (artifact: AgentArtifact) => ReactNode
}) {
  const items = ids.flatMap((id) => {
    const artifact = artifacts.find((item) => item.id === id)
    return artifact ? [artifact] : []
  })
  if (!items.length) {
    return null
  }
  if (renderMedia) {
    return (
      <>
        {items.map((artifact) => (
          <div key={artifact.id}>{renderMedia(artifact)}</div>
        ))}
      </>
    )
  }
  const visual = items.filter((item) => item.kind === 'image' || item.kind === 'video')
  if (visual.length) {
    return (
      <>
        {visual.map((artifact, index) => (
          <EventImage artifact={artifact} delay={index * 0.06} key={artifact.id} onSeek={onSeek} />
        ))}
      </>
    )
  }
  return (
    <ThinkingStepSources data-testid="agent-event-tools">
      {items.map((artifact, index) => (
        <EventSource artifact={artifact} delay={index * 0.05} key={artifact.id} onSeek={onSeek} />
      ))}
    </ThinkingStepSources>
  )
}

/** Use a single thinking rail for the actual sequence of reasoning and tool activity. */
export function AgentEventStream({
  message,
  run,
  artifacts,
  onSeek,
  onDecideTool,
  renderMedia,
  translate: t
}: {
  translate: (key: string, options?: Record<string, unknown>) => string
  renderMedia?: (artifact: AgentArtifact) => ReactNode
  message: AgentChatMessage
  run?: AgentChatRun
  artifacts: AgentArtifact[]
  onSeek?: (seconds: number) => void
  onDecideTool?: (input: { toolCallId: string; approved: boolean; remember: boolean }) => void
}) {
  const running = run?.status === 'running'
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!running) {
      return
    }
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  const rows = eventRows(message, run)
  const failed = run?.status === 'error'
  const stopped = run?.status === 'aborted' || run?.status === 'interrupted'
  const awaitingApproval = run?.tools.some((tool) => tool.status === 'pending-approval') ?? false
  const hasTail = message.legacy || failed || stopped
  const userClosed = useRef(false)
  const [open, setOpen] = useState(() => running || failed || stopped || awaitingApproval)
  useEffect(() => {
    if (failed || stopped || awaitingApproval) {
      setOpen(true)
      return
    }
    if (running) {
      if (!userClosed.current) {
        setOpen(true)
      }
      return
    }
    if (!userClosed.current) {
      setOpen(false)
    }
  }, [awaitingApproval, failed, running, stopped])
  if (!(rows.length || running || hasTail)) {
    return null
  }
  const startedAt = run?.createdAt ?? message.createdAt
  const elapsedMs = running ? Math.max(0, now - startedAt) : (message.thinkingMs ?? 0)
  const header =
    elapsedMs || running
      ? thinkingDurationHeader(t, running, elapsedMs)
      : t('transcript.promptThinking')
  return (
    <ThinkingSteps
      className="w-full font-sans"
      data-testid="transcript-prompt-thinking"
      onOpenChange={(next) => {
        userClosed.current = !next
        setOpen(next)
      }}
      open={open}
    >
      <ThinkingStepsHeader icon="brain">{header}</ThinkingStepsHeader>
      <AgentThinkingContent label={t('transcript.promptThinking')} open={open}>
        {rows.map((event, index) => {
          const tool =
            event.kind === 'tool' ? run?.tools.find((item) => item.id === event.toolId) : undefined
          const last = index === rows.length - 1 && !hasTail && !(running && run?.contextStatus)
          const active = running && last
          const label =
            event.kind === 'tool'
              ? `${t(`agentChat.tools.${event.name}`)}${event.count === undefined ? '' : ` (${event.count})`}`
              : event.kind === 'status'
                ? t(
                    event.status === 'retrying'
                      ? 'agentChat.retrying'
                      : `agentChat.contextStatus.${event.status}`
                  )
                : event.text
          const description =
            tool?.status === 'error'
              ? t('agentChat.eventStatus.error')
              : tool?.status === 'pending-approval'
                ? t('agentChat.eventStatus.pendingApproval')
                : tool?.status === 'denied'
                  ? t('agentChat.eventStatus.denied')
                  : tool?.detail === 'downloading'
                    ? t('agentChat.downloading')
                    : tool?.detail
          return (
            <ThinkingStep
              description={description}
              icon={
                event.kind === 'tool'
                  ? (toolIcons[event.name as keyof typeof toolIcons] ?? 'settings')
                  : event.kind === 'status'
                    ? 'brain'
                    : 'dot'
              }
              isLast={last}
              key={event.id}
              label={label}
              showIcon={event.kind === 'tool' || event.kind === 'status'}
              status={active ? 'active' : 'complete'}
            >
              {event.kind === 'tool' && tool?.status === 'pending-approval' && onDecideTool ? (
                <div className="flex flex-col gap-2">
                  <p className="text-muted-foreground text-xs">
                    {t('agentChat.approval.pending', {
                      summary: tool.approval?.summary ?? event.name
                    })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() =>
                        onDecideTool({ toolCallId: event.toolId, approved: true, remember: false })
                      }
                      size="sm"
                      type="button"
                    >
                      {t('agentChat.approval.allow')}
                    </Button>
                    <Button
                      onClick={() =>
                        onDecideTool({ toolCallId: event.toolId, approved: true, remember: true })
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {t('agentChat.approval.allowAndRemember')}
                    </Button>
                    <Button
                      onClick={() =>
                        onDecideTool({ toolCallId: event.toolId, approved: false, remember: false })
                      }
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {t('agentChat.approval.deny')}
                    </Button>
                  </div>
                </div>
              ) : event.kind === 'tool' ? (
                <EventMedia
                  artifacts={artifacts}
                  ids={event.artifactIds}
                  onSeek={onSeek}
                  renderMedia={renderMedia}
                />
              ) : null}
            </ThinkingStep>
          )
        })}
        {!rows.length && running ? (
          <ThinkingStep
            isLast={!hasTail}
            label={t('transcript.promptRunning')}
            showIcon={false}
            status="active"
          />
        ) : null}
        {running && run?.contextStatus ? (
          <ThinkingStep
            icon="brain"
            isLast={!hasTail}
            label={t(`agentChat.contextStatus.${run.contextStatus}`)}
            status="active"
          />
        ) : null}
        {message.legacy ? (
          <ThinkingStep
            isLast={!(failed || stopped)}
            label={t('agentChat.imported')}
            showIcon={false}
          />
        ) : null}
        {failed ? <ThinkingStep icon="x" isLast label={t('agentChat.eventStatus.error')} /> : null}
        {stopped ? (
          <ThinkingStep
            icon="pause"
            isLast
            label={t(
              run?.status === 'aborted' ? 'transcript.promptAborted' : 'agentChat.interrupted'
            )}
          />
        ) : null}
      </AgentThinkingContent>
    </ThinkingSteps>
  )
}
