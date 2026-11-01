import { AgentUiCards } from '@renderer/components/agent/AgentUiCards'
import { exportFileName } from '@renderer/lib/capture-prompt-share'
import { ipcServices } from '@renderer/lib/ipc'
import { thinkingDurationHeader } from '@renderer/lib/thinking-header'
import { agentTaskAiSnapshotAtom } from '@renderer/store/agent-tasks'
import { type AgentChatMessage, type AgentThread, selectedAgentMessages } from '@shared/agent-chat'
import { artifactsForMessage } from '@shared/agent-markdown'
import { agentUiHasProgressSteps } from '@shared/agent-ui'
import { AgentReplyActions } from '@vidbee/ui/components/agent-reply-actions'
import { AgentUserPrompt } from '@vidbee/ui/components/agent-user-prompt'
import { AgentMessageLayout } from '@vidbee/ui/components/agent-workspace'
import { cn } from '@vidbee/ui/lib/cn'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AgentChatRunFeedback } from './AgentChatRunFeedback'
import { AgentEventStream } from './AgentEventStream'
import { AgentResponseContent, agentArtifactUrl } from './AgentResponseContent'
import { TranscriptOverviewResult } from './TranscriptOverviewResult'

const MESSAGE_IMAGE_MAX_EDGE = 320

/** Render one user or agent reply with its own tools, branch controls and actions. */
export function AgentChatMessageView({
  message,
  thread,
  busy,
  overview,
  currentTimeMs,
  durationMs,
  sourceTitle,
  sourceUrl,
  onSeek,
  onRetry,
  onDecideTool,
  onShare,
  onBranch
}: {
  message: AgentChatMessage
  thread: AgentThread
  busy: boolean
  overview: boolean
  currentTimeMs: number
  durationMs: number
  /** Media title used as the default PDF / Markdown file name. */
  sourceTitle?: string | null
  /** Original video URL appended to PDF and Markdown exports. */
  sourceUrl?: string | null
  onSeek?: (seconds: number) => void
  onRetry: (id: string) => void
  onDecideTool?: (input: { toolCallId: string; approved: boolean; remember: boolean }) => void
  onShare: (id: string) => void
  onBranch: (id: string) => void
}) {
  const { t } = useTranslation()
  const aiSnapshot = useAtomValue(agentTaskAiSnapshotAtom)
  const run = thread.runs.find((item) => item.id === message.runId)
  const images = (message.imageIds ?? []).flatMap(
    (id) => thread.images?.find((image) => image.id === id) ?? []
  )
  const singleImage = images.length === 1 ? images[0] : undefined
  const singleImageWidth = singleImage
    ? singleImage.width *
      Math.min(
        1,
        MESSAGE_IMAGE_MAX_EDGE / singleImage.width,
        MESSAGE_IMAGE_MAX_EDGE / singleImage.height
      )
    : undefined
  const initialSkill = !message.parentId && thread.promptId !== 'chat' ? thread.promptId : undefined
  const sourceOffset = run?.sourceOffset ?? 0
  /** Translate source timestamps back into the locally downloaded excerpt. */
  const seekSource = useMemo(
    () =>
      onSeek ? (seconds: number): void => onSeek(Math.max(0, seconds - sourceOffset)) : undefined,
    [onSeek, sourceOffset]
  )
  const running = run?.status === 'running'
  const hasProgress = run?.tools.some(
    (tool) =>
      tool.ui && ['running', 'completed'].includes(tool.status) && agentUiHasProgressSteps(tool.ui)
  )
  const versions = thread.messages.filter(
    (item) => item.role === 'assistant' && item.parentId === message.parentId
  )
  const versionIndex = versions.findIndex((item) => item.id === message.id)
  const artifacts = artifactsForMessage(
    thread.artifacts,
    message.text,
    selectedAgentMessages({ ...thread, leafId: message.id }).map((item) => item.runId)
  )
  const showAnswer =
    message.role === 'user' ||
    Boolean(message.text.trim()) ||
    (!running && artifacts.some((artifact) => artifact.runId === message.runId))
  /** Copy only this message, leaving other replies and hidden reasoning out of the clipboard. */
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(message.text)
      toast.success(t('transcript.promptCopied'))
    } catch {
      toast.error(t('transcript.copyFailed'))
    }
  }
  /** Associate negative feedback with the cloud result that produced this reply. */
  async function dislike(): Promise<void> {
    if (!run?.cloudResultId) {
      return
    }
    try {
      await ipcServices.ai.dislikePrompt(run.cloudResultId)
      toast.success(t('transcript.promptFeedbackSaved'))
    } catch {
      toast.error(t('settings.account.error'))
    }
  }
  const canExport = Boolean(showAnswer && message.text.trim())
  const thinkingLabel =
    (message.thinkingMs ?? 0) > 0
      ? thinkingDurationHeader(t, false, message.thinkingMs ?? 0)
      : undefined
  /**
   * Persist this reply through a native save dialog and reveal the file.
   *
   * @param saved Path returned by the main-process save helper, or null if cancelled.
   */
  function finishExport(saved: { path: string } | null): void {
    if (!saved) {
      return
    }
    toast.success(t('transcript.promptExportSaved'))
    void ipcServices.fs.openFileLocation(saved.path)
  }
  /** Save this reply as a Markdown file. */
  async function exportMarkdown(): Promise<void> {
    if (!canExport) {
      toast.error(t('transcript.promptExportEmpty'))
      return
    }
    try {
      finishExport(
        await ipcServices.fs.saveTextFile({
          content: message.text,
          defaultFileName: exportFileName(sourceTitle, 'md'),
          threadId: thread.id,
          ...(sourceUrl ? { source: { url: sourceUrl, label: t('transcript.info.url') } } : {}),
          ...(thinkingLabel ? { thinkingLabel } : {})
        })
      )
    } catch {
      toast.error(t('transcript.promptExportFailed'))
    }
  }
  /** Render this reply as a printable PDF and save it. */
  async function exportPdf(): Promise<void> {
    if (!canExport) {
      toast.error(t('transcript.promptExportEmpty'))
      return
    }
    try {
      finishExport(
        await ipcServices.fs.saveMarkdownPdf({
          defaultFileName: exportFileName(sourceTitle, 'pdf'),
          markdown: message.text,
          threadId: thread.id,
          title: sourceTitle ?? undefined,
          ...(sourceUrl ? { source: { url: sourceUrl, label: t('transcript.info.url') } } : {}),
          ...(thinkingLabel ? { thinkingLabel } : {})
        })
      )
    } catch {
      toast.error(t('transcript.promptExportFailed'))
    }
  }
  return (
    <AgentMessageLayout
      actions={
        message.role === 'assistant' && !running ? (
          <AgentReplyActions
            busy={busy}
            canExport={canExport}
            feedbackEnabled={Boolean(run?.cloudResultId)}
            onBranch={onBranch}
            onCopy={() => void copy()}
            onExport={(format) => void (format === 'pdf' ? exportPdf() : exportMarkdown())}
            onFeedback={() => void dislike()}
            onRetry={() => onRetry(message.id)}
            onShare={() => onShare(message.id)}
            t={t}
            versionIndex={versionIndex}
            versions={versions.map((item) => item.id)}
          />
        ) : null
      }
      feedback={
        message.role === 'assistant' && !(running && hasProgress) ? (
          <AgentChatRunFeedback busy={busy} onRetry={() => onRetry(message.id)} run={run} />
        ) : null
      }
      id={message.id}
      media={
        message.role === 'user' && images.length ? (
          <div
            className={cn(
              'max-w-full overflow-hidden rounded-3xl bg-muted/30 ring-1 ring-border/50',
              !singleImage && 'grid w-80 grid-cols-2 gap-0.5'
            )}
            data-slot="message-images"
            style={singleImage ? { width: singleImageWidth } : undefined}
          >
            {images.map((image) => (
              <img
                alt={image.name}
                className={
                  singleImage
                    ? 'block h-auto w-full'
                    : 'block aspect-square w-full min-w-0 object-cover last:odd:col-span-2 last:odd:aspect-2/1'
                }
                height={image.height}
                key={image.id}
                src={agentArtifactUrl(image)}
                width={image.width}
              />
            ))}
          </div>
        ) : null
      }
      thinking={
        message.role === 'assistant' &&
        (run || message.thinking || message.legacy || (message.thinkingMs ?? 0) > 0) ? (
          <AgentEventStream
            artifacts={artifacts}
            message={message}
            onDecideTool={onDecideTool}
            onSeek={seekSource}
            run={run}
          />
        ) : null
      }
      user={message.role === 'user'}
    >
      {message.role === 'user' ? (
        message.text.trim() || initialSkill ? (
          <AgentUserPrompt
            initialSkill={initialSkill}
            skills={aiSnapshot?.prompts}
            t={t}
            text={message.text}
          />
        ) : null
      ) : (
        <>
          {showAnswer ? (
            overview && message.text ? (
              <TranscriptOverviewResult
                artifacts={artifacts}
                currentTimeMs={currentTimeMs + sourceOffset * 1000}
                durationMs={durationMs + sourceOffset * 1000}
                markdown={message.text}
                onSeek={seekSource}
                ownRunId={message.runId ?? undefined}
              />
            ) : (
              <AgentResponseContent
                artifacts={artifacts}
                onSeek={seekSource}
                ownRunId={message.runId ?? undefined}
                running={running}
                text={message.text}
              />
            )
          ) : null}
          <AgentUiCards artifacts={artifacts} messageId={message.id} run={run} />
        </>
      )}
    </AgentMessageLayout>
  )
}
