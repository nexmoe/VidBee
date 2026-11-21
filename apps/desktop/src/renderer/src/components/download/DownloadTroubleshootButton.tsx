import { Button } from '@renderer/components/ui/button'
import { ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import { AGENT_WORKSPACE_ID } from '@shared/agent-chat'
import { AI_CHAT_PROMPT_ID } from '@shared/ai-prompts'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/** Open a dedicated diagnostic conversation and durably send one task-specific request. */
export function DownloadTroubleshootButton({ taskId }: { taskId: string }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)

  /** Admit before navigating so revisiting or reloading Chat cannot resend the request. */
  async function troubleshoot(): Promise<void> {
    if (pending.current) {
      return
    }
    pending.current = true
    setBusy(true)
    try {
      const thread = await ipcServices.ai.createAgentThread({ downloadId: AGENT_WORKSPACE_ID })
      await ipcServices.ai.sendAgentMessage({
        downloadId: AGENT_WORKSPACE_ID,
        promptId: AI_CHAT_PROMPT_ID,
        threadId: thread.id,
        text: `$diagnose-task ${t('download.troubleshootPrompt', { taskId })}`,
        uiLanguage: i18n.language
      })
      await navigate({ to: '/chat', search: { thread: thread.id } })
    } catch (error) {
      logger.error('Failed to start download troubleshooting:', error)
      toast.error(t('download.troubleshootFailed'))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <Button
      className="h-6 gap-1 px-1.5 text-[10px] [&_svg]:size-3"
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation()
        void troubleshoot()
      }}
      size="sm"
      type="button"
      variant="default"
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
      {t('download.troubleshoot')}
    </Button>
  )
}
