import { thinkingDurationHeader } from '@renderer/lib/thinking-header'
import {
  type AgentActivity,
  type AgentArtifact,
  type AgentChatMessage,
  type AgentChatRun,
  agentThinkingElapsedMs
} from '@shared/agent-chat'
import { classifyAiPromptError } from '@shared/ai-run'
import {
  ThinkingStep,
  ThinkingStepImage,
  ThinkingStepSource,
  ThinkingStepSources,
  ThinkingSteps,
  ThinkingStepsContent,
  ThinkingStepsHeader
} from '@vidbee/ui/components/ui/thinking-steps'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TranscriptPromptGuidance } from './TranscriptPromptGuidance'

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

/** Expand each reasoning paragraph once, preserving its position between tool calls. */
export function eventRows(message: AgentChatMessage, run?: AgentChatRun): AgentActivity[] {
  const activity = run?.activity?.length
    ? run.activity
    : [
        ...(message.thinking.trim()
          ? [{ id: 'thinking', kind: 'thinking' as const, text: message.thinking }]
          : []),
        ...(run?.tools.map((tool) => ({
          id: tool.id,
          kind: 'tool' as const,
          toolId: tool.id,
          name: tool.name,
          artifactIds: []
        })) ?? [])
      ]
  return activity.flatMap((event) =>
    event.kind === 'thinking'
      ? event.text
          .split(/\n\s*\n/)
          .map((text, index) => ({ ...event, id: `${event.id}:${index}`, text: text.trim() }))
          .filter((event) => event.text)
      : [event]
  )
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
  onSeek
}: {
  artifacts: AgentArtifact[]
  ids: string[]
  onSeek?: (seconds: number) => void
}) {
  const items = ids.flatMap((id) => {
    const artifact = artifacts.find((item) => item.id === id)
    return artifact ? [artifact] : []
  })
  if (!items.length) {
    return null
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
  onRetry
}: {
  message: AgentChatMessage
  run?: AgentChatRun
  artifacts: AgentArtifact[]
  onSeek?: (seconds: number) => void
  onRetry: () => void
}) {
  const { t } = useTranslation()
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
  const answering = Boolean(message.text.trim())
  const hasTail = message.legacy || failed || stopped
  const [open, setOpen] = useState(() => (!answering && running) || failed || stopped)
  useEffect(() => {
    if (failed || stopped) {
      setOpen(true)
      return
    }
    if (answering) {
      setOpen(false)
    }
  }, [answering, failed, stopped])
  if (!(rows.length || running || hasTail)) {
    return null
  }
  const startedAt = run?.createdAt ?? message.createdAt
  const elapsedMs = running ? agentThinkingElapsedMs(startedAt, now) : (message.thinkingMs ?? 0)
  const header =
    elapsedMs || running
      ? thinkingDurationHeader(t, running, elapsedMs)
      : t('transcript.promptThinking')
  return (
    <ThinkingSteps
      className="w-full font-sans"
      data-testid="transcript-prompt-thinking"
      onOpenChange={setOpen}
      open={open}
    >
      <ThinkingStepsHeader icon="brain">{header}</ThinkingStepsHeader>
      <ThinkingStepsContent>
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
              {event.kind === 'tool' ? (
                <EventMedia artifacts={artifacts} ids={event.artifactIds} onSeek={onSeek} />
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
        {failed && run?.error ? (
          <ThinkingStep icon="x" isLast label={t('agentChat.eventStatus.error')}>
            <TranscriptPromptGuidance
              error={run.error}
              errorCode={classifyAiPromptError(run.error)}
              onRetry={onRetry}
              usingCloud={run.model === 'vidbee-cloud'}
            />
          </ThinkingStep>
        ) : null}
        {stopped ? (
          <ThinkingStep
            icon="pause"
            isLast
            label={t(
              run?.status === 'aborted' ? 'transcript.promptAborted' : 'agentChat.interrupted'
            )}
          />
        ) : null}
      </ThinkingStepsContent>
    </ThinkingSteps>
  )
}
