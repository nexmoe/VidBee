import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Ellipsis,
  RotateCw,
  Share2,
  ThumbsDown
} from 'lucide-react'
import { AgentMessageAction } from './agent-workspace'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'

/** Keep reply actions and version navigation identical across native and browser conversations. */
export function AgentReplyActions({
  canExport,
  busy,
  feedbackEnabled,
  copied,
  versions,
  versionIndex,
  onCopy,
  onShare,
  onFeedback,
  onRetry,
  onExport,
  onBranch,
  t
}: {
  canExport: boolean
  busy: boolean
  feedbackEnabled: boolean
  copied?: boolean
  versions: string[]
  versionIndex: number
  onCopy: () => void
  onShare: () => void
  onFeedback: () => void
  onRetry: () => void
  onExport: (format: 'md' | 'pdf') => void
  onBranch: (id: string) => void
  t: (key: string) => string
}) {
  return (
    <>
      <AgentMessageAction
        disabled={!canExport}
        label={t('transcript.promptShare')}
        onClick={onShare}
        testId="transcript-prompt-share"
      >
        <Share2 />
      </AgentMessageAction>
      <AgentMessageAction
        disabled={!canExport}
        label={t(copied ? 'transcript.promptCopied' : 'transcript.promptCopy')}
        onClick={onCopy}
        testId="transcript-prompt-copy"
      >
        <Copy />
      </AgentMessageAction>
      <AgentMessageAction
        disabled={!feedbackEnabled}
        label={t('transcript.promptDislike')}
        onClick={onFeedback}
      >
        <ThumbsDown />
      </AgentMessageAction>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t('transcript.promptMore')}
            className="h-6 w-6 justify-center rounded-md p-0 text-muted-foreground [&_svg]:size-3.5"
            data-testid="transcript-prompt-more"
            size="icon"
            variant="ghost"
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            data-testid="transcript-prompt-rerun"
            disabled={busy}
            onSelect={onRetry}
          >
            <RotateCw />
            {t('transcript.promptRerun')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="transcript-prompt-export-pdf"
            disabled={!canExport}
            onSelect={() => onExport('pdf')}
          >
            {t('transcript.promptExportPdf')}
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="transcript-prompt-export-markdown"
            disabled={!canExport}
            onSelect={() => onExport('md')}
          >
            {t('transcript.promptExportMarkdown')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {versions.length > 1 ? (
        <div className="ml-1 flex items-center gap-0.5 tabular-nums">
          <AgentMessageAction
            disabled={busy || versionIndex <= 0}
            label={t('agentChat.previousVersion')}
            onClick={() => onBranch(versions[versionIndex - 1] ?? versions[versionIndex] ?? '')}
          >
            <ChevronLeft />
          </AgentMessageAction>
          <span aria-live="polite">
            {versionIndex + 1}/{versions.length}
          </span>
          <AgentMessageAction
            disabled={busy || versionIndex >= versions.length - 1}
            label={t('agentChat.nextVersion')}
            onClick={() => onBranch(versions[versionIndex + 1] ?? versions[versionIndex] ?? '')}
          >
            <ChevronRight />
          </AgentMessageAction>
        </div>
      ) : null}
    </>
  )
}
