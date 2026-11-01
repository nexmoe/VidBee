import { aiPromptLabel as sharedPromptLabel } from '@shared/ai-prompts'

/** Keep existing renderer callers on the shared compatibility and localization rules. */
export const aiPromptLabel = (...args: Parameters<typeof sharedPromptLabel>): string =>
  sharedPromptLabel(...args)
