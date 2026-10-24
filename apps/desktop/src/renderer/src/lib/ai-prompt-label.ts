import type { AiPrompt } from '@shared/ai-types'

/**
 * Translate a built-in prompt title, falling back to the stored title for custom skills.
 *
 * @param prompt Prompt record.
 * @param t i18n function.
 */
export const aiPromptLabel = (
  prompt: Pick<AiPrompt, 'id' | 'isPreset' | 'title'>,
  t: (key: string) => string
): string => (prompt.isPreset ? t(`settings.ai.presetPrompts.${prompt.id}.title`) : prompt.title)
