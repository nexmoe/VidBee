import { Bubble, BubbleContent } from '@renderer/components/ui/bubble'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Message, MessageContent, MessageFooter } from '@renderer/components/ui/message'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { exportFileName } from '@renderer/lib/capture-prompt-share'
import { ipcServices } from '@renderer/lib/ipc'
import { type AgentChatMessage, type AgentThread, selectedAgentMessages } from '@shared/agent-chat'
import { artifactsForMessage } from '@shared/agent-markdown'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Ellipsis,
  RotateCw,
  Share2,
  ThumbsDown
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AgentEventStream } from './AgentEventStream'
import { AgentResponseContent, agentArtifactUrl } from './AgentResponseContent'
import { TranscriptOverviewResult } from './TranscriptOverviewResult'

/** Compact ghost icon so the reply toolbar matches body text instead of a 36px control. */
function MessageAction({
  label,
  disabled,
  onClick,
  children,
  testId
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
  testId?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className="h-6 w-6 justify-start rounded-md p-0 text-muted-foreground [&_svg]:size-3.5"
          data-testid={testId}
          disabled={disabled}
          onClick={onClick}
          size="icon"
          type="button"
          variant="ghost"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Render one user or agent reply with its own tools, branch controls and actions. */
export function AgentChatMessageView({
  message,
  thread,
  busy,
  overview,
  currentTimeMs,
  durationMs,
  sourceTitle,
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
  onSeek?: (seconds: number) => void
  onRetry: (id: string) => void
  onDecideTool?: (input: { toolCallId: string; approved: boolean; remember: boolean }) => void
  onShare: (id: string) => void
  onBranch: (id: string) => void
}) {
  const { t } = useTranslation()
  const run = thread.runs.find((item) => item.id === message.runId)
  const images = (message.imageIds ?? []).flatMap(
    (id) => thread.images?.find((image) => image.id === id) ?? []
  )
  const sourceOffset = run?.sourceOffset ?? 0
  /** Translate source timestamps back into the locally downloaded excerpt. */
  const seekSource = onSeek
    ? (seconds: number): void => onSeek(Math.max(0, seconds - sourceOffset))
    : undefined
  const running = run?.status === 'running'
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
          threadId: thread.id
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
          title: sourceTitle ?? undefined
        })
      )
    } catch {
      toast.error(t('transcript.promptExportFailed'))
    }
  }
  return (
    <Message align={message.role === 'user' ? 'end' : 'start'} data-message-id={message.id}>
      <MessageContent className="gap-2">
        {message.role === 'assistant' && (run || message.thinking || message.legacy) ? (
          <AgentEventStream
            artifacts={artifacts}
            message={message}
            onDecideTool={onDecideTool}
            onRetry={() => onRetry(message.id)}
            onSeek={seekSource}
            run={run}
          />
        ) : null}
        {showAnswer ? (
          <Bubble
            className={message.role === 'assistant' ? 'w-full max-w-full' : 'max-w-full'}
            variant={message.role === 'assistant' ? 'ghost' : 'default'}
          >
            <BubbleContent
              className={
                message.role === 'assistant'
                  ? 'w-full max-w-none overflow-visible p-0'
                  : 'w-full max-w-none'
              }
            >
              {message.role === 'user' ? (
                <div className="flex flex-col gap-2">
                  {images.length ? (
                    <div className="flex max-w-sm flex-wrap justify-end gap-2">
                      {images.map((image) => (
                        <img
                          alt={image.name}
                          className="h-auto max-h-60 w-auto max-w-full rounded-lg object-contain"
                          height={image.height}
                          key={image.id}
                          src={agentArtifactUrl(image)}
                          width={image.width}
                        />
                      ))}
                    </div>
                  ) : null}
                  {message.text ? (
                    <p className="whitespace-pre-wrap" dir="auto">
                      {message.text}
                    </p>
                  ) : null}
                </div>
              ) : overview && seekSource && message.text ? (
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
              )}
            </BubbleContent>
          </Bubble>
        ) : null}
        {message.role === 'assistant' && !running ? (
          <MessageFooter className="gap-0 px-0">
            <MessageAction
              disabled={!showAnswer || running || !message.text.trim()}
              label={t('transcript.promptShare')}
              onClick={() => onShare(message.id)}
              testId="transcript-prompt-share"
            >
              <Share2 />
            </MessageAction>
            <MessageAction
              disabled={!(showAnswer && message.text.trim())}
              label={t('transcript.promptCopy')}
              onClick={() => void copy()}
              testId="transcript-prompt-copy"
            >
              <Copy />
            </MessageAction>
            <MessageAction
              disabled={running || !run?.cloudResultId}
              label={t('transcript.promptDislike')}
              onClick={() => void dislike()}
            >
              <ThumbsDown />
            </MessageAction>
            <DropdownMenu modal={false}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label={t('transcript.promptMore')}
                      className="h-6 w-6 justify-start rounded-md p-0 text-muted-foreground [&_svg]:size-3.5"
                      data-testid="transcript-prompt-more"
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('transcript.promptMore')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="transcript-prompt-rerun"
                  disabled={busy}
                  onSelect={() => onRetry(message.id)}
                >
                  <RotateCw />
                  {t('transcript.promptRerun')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-testid="transcript-prompt-export-pdf"
                  disabled={!canExport}
                  onSelect={() => void exportPdf()}
                >
                  {t('transcript.promptExportPdf')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="transcript-prompt-export-markdown"
                  disabled={!canExport}
                  onSelect={() => void exportMarkdown()}
                >
                  {t('transcript.promptExportMarkdown')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {versions.length > 1 ? (
              <div className="ml-1 flex items-center gap-0.5 tabular-nums">
                <MessageAction
                  disabled={busy || versionIndex === 0}
                  label={t('agentChat.previousVersion')}
                  onClick={() => onBranch(versions[versionIndex - 1].id)}
                >
                  <ChevronLeft />
                </MessageAction>
                <span aria-live="polite">
                  {versionIndex + 1}/{versions.length}
                </span>
                <MessageAction
                  disabled={busy || versionIndex === versions.length - 1}
                  label={t('agentChat.nextVersion')}
                  onClick={() => onBranch(versions[versionIndex + 1].id)}
                >
                  <ChevronRight />
                </MessageAction>
              </div>
            ) : null}
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  )
}
