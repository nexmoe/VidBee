import type { AiPrompt } from '@shared/ai-types'
import type { TFunction } from 'i18next'

const SKILL_USAGE_GROUPS: Record<string, string> = {
  overview: 'summary',
  'bullet-points': 'summary',
  'improve-grammar': 'rewrite',
  'paraphrase-content': 'rewrite',
  'article-rewrite': 'rewrite',
  'generate-faq': 'faq',
  faq: 'faq',
  translate: 'translate',
  'extract-statistics': 'statistics',
  'create-mindmap': 'mindmap',
  'diagnose-task': 'diagnose'
}

/** Offer localized starting requests for built-in workflows and a general guide for custom skills. */
export function skillUsageSuggestions(prompt: AiPrompt, t: TFunction): string[] {
  const group =
    (prompt.isPreset || prompt.workflowOnly ? SKILL_USAGE_GROUPS[prompt.name] : undefined) ??
    'custom'
  return ['first', 'second', 'third'].map((example) =>
    t(`settings.ai.skillUsage.${group}.${example}`)
  )
}
