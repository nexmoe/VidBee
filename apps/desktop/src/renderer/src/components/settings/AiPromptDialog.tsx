import { TranscriptPromptThinking } from '@renderer/components/transcript/TranscriptPromptThinking'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Response } from '@renderer/components/ui/response'
import { Switch } from '@renderer/components/ui/switch'
import { Textarea } from '@renderer/components/ui/textarea'
import { usePromptRun } from '@renderer/hooks/use-prompt-run'
import { AI_PROMPT_SAMPLE_TRANSCRIPT, resolveAiPromptContent } from '@shared/ai-prompts'
import { isThinkingSameAsAnswer } from '@shared/ai-thinking'
import {
  AI_PROMPT_TEST_DOWNLOAD_ID,
  type AiPrompt,
  type AiPromptWriteInput
} from '@shared/ai-types'
import { Square } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface AiPromptDialogProps {
  onDelete?: () => Promise<void>
  onOpenChange: (open: boolean) => void
  onSave: (input: AiPromptWriteInput) => Promise<void>
  open: boolean
  prompt?: AiPrompt | null
  saving?: boolean
}

/**
 * Dialog for creating or editing a transcript prompt, including a sample run.
 */
export function AiPromptDialog({
  onDelete,
  onOpenChange,
  onSave,
  open,
  prompt,
  saving = false
}: AiPromptDialogProps) {
  const { i18n, t } = useTranslation()
  const titleId = useId()
  const bodyId = useId()
  const sampleId = useId()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [autoRun, setAutoRun] = useState(false)
  const [sample, setSample] = useState(AI_PROMPT_SAMPLE_TRANSCRIPT)
  const testPromptId = prompt?.id ?? null
  const { run, start, stop } = usePromptRun(AI_PROMPT_TEST_DOWNLOAD_ID, open ? testPromptId : null)
  const running = run.status === 'running'
  const thinking = run.thinking?.trim() ?? ''
  const showThinking =
    running || (thinking.length > 0 && !isThinkingSameAsAnswer(thinking, run.text))
  useEffect(() => {
    if (!open) {
      return
    }
    setTitle(prompt?.title ?? '')
    setContent(prompt ? resolveAiPromptContent(prompt.content, i18n.language) : '')
    setAutoRun(prompt?.autoRun ?? false)
    setSample(AI_PROMPT_SAMPLE_TRANSCRIPT)
  }, [i18n.language, open, prompt])

  const canSave = title.trim().length > 0 && content.trim().length > 0

  /**
   * Persist the prompt before a sample run so the main process has the latest text.
   */
  const persist = async (): Promise<AiPromptWriteInput> => {
    const input: AiPromptWriteInput = {
      id: prompt?.id,
      title: title.trim(),
      content: content.trim(),
      enabled: prompt?.enabled,
      autoRun
    }
    await onSave(input)
    return input
  }

  /**
   * Save without closing when the user only wanted to run a sample.
   */
  const handleSave = async (close: boolean): Promise<void> => {
    if (!canSave || saving) {
      return
    }
    await persist()
    if (close) {
      onOpenChange(false)
    }
  }

  /**
   * Save the current prompt, then stream a sample through the enabled provider.
   */
  const handleTest = async (): Promise<void> => {
    if (running) {
      await stop()
      return
    }
    await handleSave(false)
    if (prompt?.id) {
      await start(sample)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {prompt ? t('settings.ai.editPrompt') : t('settings.ai.addPrompt')}
          </DialogTitle>
          <DialogDescription>{t('settings.ai.promptDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 w-full min-w-0 gap-4 overflow-y-auto overflow-x-hidden">
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={titleId}>{t('settings.ai.promptTitle')}</Label>
            <Input
              id={titleId}
              onChange={(event) => setTitle(event.currentTarget.value)}
              value={title}
            />
          </div>
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={bodyId}>{t('settings.ai.promptBody')}</Label>
            <Textarea
              className="min-h-32"
              id={bodyId}
              onChange={(event) => setContent(event.currentTarget.value)}
              value={content}
            />
          </div>
          <div className="rounded-md border bg-muted/20 p-4">
            <Switch
              checked={autoRun}
              className="flex-row-reverse justify-between gap-4 px-0 py-0 [&>span]:font-medium [&>span]:text-foreground"
              label={t('settings.ai.promptAutoRun')}
              onToggle={() => setAutoRun((current) => !current)}
            />
            <p className="mt-1 pr-12 text-muted-foreground text-sm leading-relaxed">
              {t('settings.ai.promptAutoRunDescription')}
            </p>
          </div>
          {prompt ? (
            <div className="grid gap-2 rounded-md border bg-muted/30 p-4">
              <Label htmlFor={sampleId}>{t('settings.ai.testTitle')}</Label>
              <Input
                id={sampleId}
                onChange={(event) => setSample(event.currentTarget.value)}
                value={sample}
              />
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-sm">{t('settings.ai.testOutput')}</p>
                <Button onClick={() => void handleTest()} size="sm" type="button" variant="outline">
                  {running ? <Square /> : null}
                  {running ? t('settings.ai.testStop') : t('settings.ai.testRun')}
                </Button>
              </div>
              <div className="min-h-32 rounded-md border bg-background p-3 text-sm">
                {showThinking || run.text ? (
                  <div className="flex flex-col gap-3">
                    {showThinking ? (
                      <TranscriptPromptThinking
                        running={running}
                        thinking={thinking}
                        thinkingMs={run.thinkingMs}
                      />
                    ) : null}
                    {run.text ? <Response isAnimating={running}>{run.text}</Response> : null}
                  </div>
                ) : (
                  <p className="text-muted-foreground">{t('settings.ai.testPlaceholder')}</p>
                )}
                {run.error ? <p className="mt-2 text-destructive text-sm">{run.error}</p> : null}
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter className="shrink-0 flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-between">
          {prompt && onDelete ? (
            <Button
              className="text-destructive"
              onClick={() => void onDelete()}
              type="button"
              variant="ghost"
            >
              {t('settings.ai.deletePrompt')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              {t('settings.ai.cancel')}
            </Button>
            <Button
              disabled={!canSave || saving}
              onClick={() => void handleSave(true)}
              type="button"
            >
              {t('settings.ai.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
