import { Button } from '@renderer/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle
} from '@renderer/components/ui/item'
import { Switch } from '@renderer/components/ui/switch'
import { ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import { resolveAiPromptContent } from '@shared/ai-prompts'
import type { AiPrompt, AiPromptWriteInput, AiSettingsSnapshot } from '@shared/ai-types'
import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AiPromptDialog } from './AiPromptDialog'
import { AiPromptIcon } from './ai-prompt-icon'

/**
 * Translate a built-in prompt title, falling back to the stored English title.
 *
 * @param prompt Prompt record.
 * @param t i18n function.
 */
const promptTitle = (prompt: AiPrompt, t: (key: string) => string): string =>
  prompt.isPreset ? t(`settings.ai.presetPrompts.${prompt.id}.title`) : prompt.title

/**
 * Settings page for transcript prompts.
 */
export function AiPromptsPanel() {
  const { i18n, t } = useTranslation()
  const [snapshot, setSnapshot] = useState<AiSettingsSnapshot | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AiPrompt | null>(null)
  const [saving, setSaving] = useState(false)

  /**
   * Load prompts from the main process.
   */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      setSnapshot(await ipcServices.ai.getSnapshot())
    } catch (error) {
      logger.error('Failed to load AI prompts', error)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const listener = window.api.on('settings:changed', () => {
      void refresh()
    })
    return () => window.api.removeListener('settings:changed', listener)
  }, [refresh])

  /**
   * Open the editor for a new custom prompt.
   */
  const openCreate = (): void => {
    setEditing(null)
    setDialogOpen(true)
  }

  /**
   * Open the editor for an existing prompt.
   *
   * @param prompt Prompt to edit.
   */
  const openEdit = (prompt: AiPrompt): void => {
    setEditing(prompt)
    setDialogOpen(true)
  }

  /**
   * Persist dialog values.
   *
   * @param input Dialog payload.
   */
  const handleSave = async (input: AiPromptWriteInput): Promise<void> => {
    setSaving(true)
    try {
      const saved = await ipcServices.ai.upsertPrompt(input)
      await refresh()
      setEditing(saved)
    } catch (error) {
      logger.error('Failed to save AI prompt', error)
      toast.error(error instanceof Error ? error.message : t('settings.ai.saveError'))
      throw error
    } finally {
      setSaving(false)
    }
  }

  /**
   * Remove the prompt currently in the editor.
   */
  const handleDelete = async (): Promise<void> => {
    if (!editing) {
      return
    }
    try {
      setSnapshot(await ipcServices.ai.deletePrompt(editing.id))
      setDialogOpen(false)
      setEditing(null)
    } catch (error) {
      logger.error('Failed to delete AI prompt', error)
      toast.error(t('settings.ai.saveError'))
    }
  }

  /**
   * Toggle whether a prompt appears as a transcript tab.
   *
   * @param prompt Prompt to update.
   * @param enabled Next enabled flag.
   */
  const handleToggle = async (prompt: AiPrompt, enabled: boolean): Promise<void> => {
    try {
      await ipcServices.ai.upsertPrompt({
        id: prompt.id,
        title: prompt.title,
        icon: prompt.icon,
        content: prompt.content,
        enabled
      })
      await refresh()
    } catch (error) {
      logger.error('Failed to toggle AI prompt', error)
      toast.error(t('settings.ai.saveError'))
    }
  }

  /**
   * Re-insert any missing built-in prompts.
   */
  const handleRestore = async (): Promise<void> => {
    try {
      setSnapshot(await ipcServices.ai.restoreDefaultPrompts())
    } catch (error) {
      logger.error('Failed to restore default prompts', error)
      toast.error(t('settings.ai.saveError'))
    }
  }

  const prompts = snapshot?.prompts ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button onClick={() => void handleRestore()} size="sm" type="button" variant="ghost">
          {t('settings.ai.restorePresets')}
        </Button>
        <Button onClick={openCreate} size="sm" type="button">
          <Plus />
          {t('settings.ai.addPrompt')}
        </Button>
      </div>
      <ItemGroup>
        {prompts.map((prompt, index) => (
          <div key={prompt.id}>
            {index > 0 ? <ItemSeparator /> : null}
            <Item variant="muted">
              <ItemMedia variant="icon">
                <AiPromptIcon icon={prompt.icon} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{promptTitle(prompt, t)}</ItemTitle>
                <ItemDescription className="line-clamp-2">
                  {resolveAiPromptContent(prompt.content, i18n.language)}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Switch
                  checked={prompt.enabled}
                  label=""
                  onToggle={() => void handleToggle(prompt, !prompt.enabled)}
                />
                <Button onClick={() => openEdit(prompt)} size="sm" variant="outline">
                  {t('settings.ai.edit')}
                </Button>
              </ItemActions>
            </Item>
          </div>
        ))}
      </ItemGroup>
      <AiPromptDialog
        onDelete={editing ? handleDelete : undefined}
        onOpenChange={setDialogOpen}
        onSave={handleSave}
        open={dialogOpen}
        prompt={editing}
        saving={saving}
      />
    </div>
  )
}
