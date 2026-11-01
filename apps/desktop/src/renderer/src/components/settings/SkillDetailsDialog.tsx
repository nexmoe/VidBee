import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle
} from '@renderer/components/ui/item'
import { Switch } from '@renderer/components/ui/switch'
import { aiPromptLabel } from '@renderer/lib/ai-prompt-label'
import { skillUsageSuggestions } from '@renderer/lib/skill-usage-suggestions'
import { aiPromptDescription, isTranscriptSkillSidebarEnabled } from '@shared/ai-prompts'
import type { AiPrompt } from '@shared/ai-types'
import { CopyPlus, Download, FolderOpen, MessageCircle, Trash2 } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

interface SkillDetailsDialogProps {
  preferencesSaving?: boolean
  onAutoRunChange: (autoRun: boolean) => Promise<void>
  onTranscriptVisibilityChange: (showInTranscript: boolean) => Promise<void>
  onDelete?: () => Promise<void>
  onCustomize?: () => Promise<void>
  onExport?: () => Promise<void>
  onOpenDirectory?: () => Promise<void>
  onOpenChange: (open: boolean) => void
  onOpenChangeComplete: (open: boolean) => void
  onTry: (text: string) => void
  open: boolean
  prompt: AiPrompt | null
}

/** Show a skill's read-only description and suggested requests in the standard dialog. */
export function SkillDetailsDialog({
  preferencesSaving = false,
  onAutoRunChange,
  onTranscriptVisibilityChange,
  onDelete,
  onCustomize,
  onExport,
  onOpenDirectory,
  onOpenChange,
  onOpenChangeComplete,
  onTry,
  open,
  prompt
}: SkillDetailsDialogProps) {
  const { t } = useTranslation()
  const usageId = useId()
  const suggestions = prompt ? skillUsageSuggestions(prompt, t) : []
  const canTry = Boolean(prompt && !prompt.skillError)
  const showInTranscript = prompt ? isTranscriptSkillSidebarEnabled(prompt) : false

  /** Start an editable chat request using the installed skill's explicit invocation name. */
  function trySuggestion(suggestion: string): void {
    if (prompt && canTry) {
      onTry(`$${prompt.name} ${suggestion}`)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete} open={open}>
      {prompt ? (
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="break-words pr-6">{aiPromptLabel(prompt, t)}</DialogTitle>
            <DialogDescription className="whitespace-pre-wrap break-words">
              {aiPromptDescription(prompt, t)}
            </DialogDescription>
          </DialogHeader>
          <ItemGroup>
            <Item variant="muted">
              <ItemContent>
                <ItemTitle>{t('settings.ai.skillShowInTranscript')}</ItemTitle>
                <ItemDescription>
                  {t('settings.ai.skillShowInTranscriptDescription')}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Switch
                  checked={showInTranscript}
                  className="px-0 py-0 [&>span:last-child]:sr-only"
                  disabled={preferencesSaving}
                  label={t('settings.ai.skillShowInTranscript')}
                  onToggle={() => void onTranscriptVisibilityChange(!showInTranscript)}
                />
              </ItemActions>
            </Item>
            <ItemSeparator />
            <Item variant="muted">
              <ItemContent>
                <ItemTitle>{t('settings.ai.skillAutoRun')}</ItemTitle>
                <ItemDescription>{t('settings.ai.skillAutoRunDescription')}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Switch
                  checked={prompt.autoRun ?? false}
                  className="px-0 py-0 [&>span:last-child]:sr-only"
                  disabled={preferencesSaving}
                  label={t('settings.ai.skillAutoRun')}
                  onToggle={() => void onAutoRunChange(!prompt.autoRun)}
                />
              </ItemActions>
            </Item>
          </ItemGroup>
          <section aria-labelledby={usageId} className="grid gap-2">
            <h3 className="font-medium text-sm" id={usageId}>
              {t('settings.ai.suggestedUsage')}
            </h3>
            {suggestions.map((suggestion) => (
              <Button
                className="h-auto justify-start whitespace-normal px-3 py-2 text-left font-normal"
                disabled={!canTry}
                key={suggestion}
                onClick={() => trySuggestion(suggestion)}
                type="button"
                variant="outline"
              >
                <MessageCircle aria-hidden="true" className="text-muted-foreground" />
                {suggestion}
              </Button>
            ))}
            {prompt.skillError ? (
              <p className="break-words text-destructive text-sm">{prompt.skillError}</p>
            ) : null}
          </section>
          <DialogFooter>
            <div className="flex gap-1 sm:mr-auto">
              {onCustomize ? (
                <Button onClick={() => void onCustomize()} type="button" variant="outline">
                  <CopyPlus />
                  {t('settings.ai.customizeSkill')}
                </Button>
              ) : null}
              {onOpenDirectory ? (
                <Button
                  aria-label={t('settings.ai.openSkillFolder')}
                  onClick={() => void onOpenDirectory()}
                  size="icon"
                  title={t('settings.ai.openSkillFolder')}
                  type="button"
                  variant="ghost"
                >
                  <FolderOpen />
                </Button>
              ) : null}
              {onExport ? (
                <Button
                  aria-label={t('settings.ai.exportSkill')}
                  onClick={() => void onExport()}
                  size="icon"
                  title={t('settings.ai.exportSkill')}
                  type="button"
                  variant="ghost"
                >
                  <Download />
                </Button>
              ) : null}
              {onDelete ? (
                <Button
                  aria-label={t('settings.ai.deletePrompt')}
                  className="text-destructive"
                  onClick={() => void onDelete()}
                  size="icon"
                  title={t('settings.ai.deletePrompt')}
                  type="button"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
            <Button disabled={!canTry} onClick={() => trySuggestion(suggestions[0])} type="button">
              {t('settings.ai.trySkill')}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
