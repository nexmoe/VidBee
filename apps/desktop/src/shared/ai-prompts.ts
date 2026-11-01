import { languageList, languages, normalizeLanguageCode } from '@vidbee/i18n/languages'
import type { AiPrompt } from './ai-types'
import { BUILTIN_SKILLS } from './builtin-skills'

/** Replaced with the current UI language name before a prompt is shown or sent. */
export const AI_PROMPT_UI_LANGUAGE_TOKEN = '{{uiLanguage}}'

interface AiPromptPresetSeed {
  name: string
  description: string
  content: string
}

/** Shared Markdown hygiene appended to every built-in prompt. */
const PRESET_FORMAT_RULES =
  'Keep each list marker on the same line as the item text. Do not wrap the whole reply in a code fence. Do not add a preamble, closing remarks, or a heading that restates the task. Use the same language as the transcript.'

/** Previous official Overview seed, retained only to upgrade unedited saved presets. */
const LEGACY_OVERVIEW_CONTENT = [
  'Write a structural overview of this transcript with chapters and key quotes.',
  '',
  'Each transcript line starts with [m:ss] or [h:mm:ss]. Duration is given when known. Chapters must cover the whole timeline from start to finish. If Duration is given, the last chapter must start after 75% of that duration. Use only timestamps that appear in the transcript. Do not invent timestamps or use 0:00 unless that line exists.',
  '',
  "Include 3-5 key quotes that are surprising, contrarian, memorable, or statistically striking. Quotes must be the speaker's words. Clean filler and transcription errors, but keep their voice.",
  '',
  'Output format:',
  '# {one-sentence takeaway}',
  '## Chapters',
  '- **{m:ss}** {title} — {what this section covers}',
  '## Key quotes',
  '- **{m:ss}** "{quote}"',
  '',
  'Use unordered lists only. Keep each bullet to one or two sentences. Skip empty sections.',
  PRESET_FORMAT_RULES
].join('\n')

/** Built-in Overview prompt, pinned beside the transcript tab. */
export const AI_OVERVIEW_PROMPT_ID = 'overview'

/** Built-in skills shown in the transcript sidebar until the user chooses otherwise. */
const DEFAULT_TRANSCRIPT_SIDEBAR_SKILLS = new Set([
  AI_OVERVIEW_PROMPT_ID,
  'generate-faq',
  'create-mindmap'
])

/** Freeform Agent conversation started from New chat, not shown as a prompt tab. */
export const AI_CHAT_PROMPT_ID = 'chat'

/** Instruction used when the user starts an empty Agent conversation. */
const AGENT_CHAT_CONTENT = [
  'Answer the user about this video.',
  'Use tools when you need transcript evidence, timestamps, screenshots, or clips.',
  'Do not invent quotes or timestamps.',
  'Conversation titles are derived automatically. Use rename_conversation only when the user asks to change the title.',
  'Follow the user’s requested output language; otherwise reply in the language of their latest message. Use {{uiLanguage}} only when the user’s language cannot be determined.'
].join('\n')

/**
 * Virtual prompt for a blank Agent chat. It is not stored in settings.
 *
 * @param now Timestamp written onto createdAt and updatedAt.
 */
export const agentChatPrompt = (now: number = Date.now(), hasSource = true): AiPrompt => ({
  name: 'chat',
  content: hasSource
    ? AGENT_CHAT_CONTENT
    : [
        'Help the user with their request. No video or transcript is initially attached. Use select_video to attach completed library media; later application state identifies the selected source.',
        'Use the available tools when helpful. Do not invent source evidence or tool results.',
        'Conversation titles are derived automatically. Use rename_conversation only when the user asks to change the title.',
        'Follow the user’s requested output language; otherwise reply in the language of their latest message. Use {{uiLanguage}} only when the user’s language cannot be determined.'
      ].join('\n'),
  isPreset: true,
  sortOrder: -1,
  createdAt: now,
  updatedAt: now
})

/**
 * Default transcript skills authored in the repository library. `{{uiLanguage}}` is replaced
 * with the current interface language name before a prompt is shown or sent.
 */
export const AI_PROMPT_PRESETS: readonly AiPromptPresetSeed[] = BUILTIN_SKILLS.filter(
  (skill) => !['article-rewrite', 'faq', 'diagnose-task', 'video-localization'].includes(skill.name)
).sort(
  (left, right) =>
    Number(right.name === AI_OVERVIEW_PROMPT_ID) - Number(left.name === AI_OVERVIEW_PROMPT_ID)
)

const PRESET_NAMES = new Set(AI_PROMPT_PRESETS.map((prompt) => prompt.name))
const PRESET_SEED_BY_NAME = new Map<string, AiPromptPresetSeed>(
  AI_PROMPT_PRESETS.map((preset) => [preset.name, preset])
)

/** Built-in prompts that should no longer be seeded or restored. */
const DEPRECATED_PRESET_NAMES = new Set([
  'extract-questions',
  'highlight-key-points',
  'identify-emotions',
  'split-paragraphs'
])

/** Format rules used by the first structured official bodies. */
const SUPERSEDED_FORMAT_RULES =
  'Keep each list marker on the same line as the item text. Do not wrap the whole reply in a code fence. Do not add a preamble or closing remarks. Use the same language as the transcript.'

/** Older official bodies that should be replaced with the current seed. */
const SUPERSEDED_PRESET_CONTENT: Record<string, readonly string[]> = {
  overview: [LEGACY_OVERVIEW_CONTENT],
  'bullet-points': [
    'Turn this transcript into a bullet point summary. Group related points. Keep each bullet short and easy to scan. Use the same language as the transcript.',
    [
      'Turn this transcript into a scannable bullet summary.',
      '',
      'Output format:',
      '# {title}',
      '## {theme}',
      '- {point}',
      '',
      'Group related points under ## headings. Use unordered lists only. Keep each bullet to one sentence. Skip empty sections.',
      SUPERSEDED_FORMAT_RULES
    ].join('\n')
  ],
  'improve-grammar': [
    'Correct grammar, spelling, and punctuation so the transcript reads naturally and professionally. Keep the original meaning, speakers, and details. Do not add new facts. Use the same language as the transcript.',
    [
      'Correct grammar, spelling, and punctuation so the transcript reads naturally and professionally. Keep the original meaning, speakers, and details. Do not add new facts.',
      '',
      'Output format:',
      '# {title}',
      '## {speaker or topic}',
      '{cleaned paragraphs}',
      '',
      'Use ## headings for speaker changes or topic shifts. Write cleaned prose in paragraphs. Use an unordered or ordered list only when the original content is already a list.',
      SUPERSEDED_FORMAT_RULES
    ].join('\n')
  ],
  'generate-faq': [
    'Generate a FAQ from this transcript. Write clear questions and concise answers grounded only in the transcript. If the transcript does not contain an answer, say so. Use the same language as the transcript.',
    [
      'Generate a FAQ from this transcript. Write clear questions and concise answers grounded only in the transcript. If the transcript does not contain an answer, say so.',
      '',
      'Output format:',
      '# FAQ',
      '## {question}',
      '{answer}',
      '',
      'Use one ## heading per question. Put the answer as a short paragraph, or as an unordered list when there are several parts. Do not number the questions.',
      SUPERSEDED_FORMAT_RULES
    ].join('\n')
  ],
  'extract-statistics': [
    'Extract numbers, percentages, amounts, dates, and growth rates from this transcript. Present them as a Markdown table with columns for the statistic, what it refers to, and the surrounding context. If none are found, say so. Use the same language as the transcript.',
    [
      'Extract numbers, percentages, amounts, dates, and growth rates from this transcript.',
      '',
      'Output format:',
      '# Statistics',
      '## Highlights',
      '- {statistic} — {what it refers to}',
      '## Details',
      '| Statistic | Refers to | Context |',
      '| --- | --- | --- |',
      '| ... | ... | ... |',
      '',
      'Use an unordered list for highlights and a Markdown table for details. If none are found, say so under # Statistics.',
      SUPERSEDED_FORMAT_RULES
    ].join('\n')
  ],
  'paraphrase-content': [
    'Paraphrase this transcript in a clear, natural style while keeping the original meaning. Do not add claims that are not in the source. Use the same language as the transcript.',
    [
      'Paraphrase this transcript in a clear, natural style while keeping the original meaning. Do not add claims that are not in the source.',
      '',
      'Output format:',
      '# {title}',
      '## {section}',
      '{paraphrased paragraphs}',
      '',
      'Use ## headings for topic shifts. Prefer short paragraphs. Use an unordered list for parallel takeaways and an ordered list for steps or ranked items.',
      SUPERSEDED_FORMAT_RULES
    ].join('\n')
  ],
  'create-mindmap': [
    'Organize this transcript into a hierarchical mind map. Reply with nested Markdown lists only: a root topic, then branches, then leaves. Keep labels short. Use the same language as the transcript.',
    [
      'Organize this transcript into a hierarchical mind map.',
      '',
      'Output format:',
      '# {root topic}',
      '- {branch}',
      '  - {leaf}',
      '  - {leaf}',
      '- {branch}',
      '  - {leaf}',
      '',
      'Use a # title and nested unordered lists only. Keep labels short. Do not use numbered lists or extra commentary.',
      SUPERSEDED_FORMAT_RULES
    ].join('\n'),
    [
      'Organize this transcript into a hierarchical mind map.',
      '',
      'Output format:',
      '# {root topic}',
      '- {branch}',
      '  - {leaf}',
      '  - {leaf}',
      '- {branch}',
      '  - {leaf}',
      '',
      'Use a # heading for the root topic and nested unordered lists for branches. Keep labels short. Do not use numbered lists, extra commentary, or a Mindmap title.',
      PRESET_FORMAT_RULES
    ].join('\n')
  ]
}

/**
 * Native name of a VidBee UI language, used inside built-in prompts.
 *
 * @param languageCode Saved or i18n language tag.
 */
export const aiPromptUiLanguageName = (languageCode: string): string =>
  languages[normalizeLanguageCode(languageCode)].name

/**
 * Replace {{uiLanguage}} with the current interface language name.
 *
 * @param content Prompt body from storage.
 * @param languageCode Saved or i18n language tag.
 */
export const resolveAiPromptContent = (content: string, languageCode: string): string =>
  content.replaceAll(AI_PROMPT_UI_LANGUAGE_TOKEN, aiPromptUiLanguageName(languageCode))

/**
 * Keep {{uiLanguage}} in storage when the user saved a resolved built-in body
 * without otherwise editing it, so a later language switch still applies.
 *
 * @param promptId Prompt id from storage.
 * @param content Prompt body from the editor.
 */
export const canonicalizeAiPromptContent = (promptId: string, content: string): string => {
  const seed = PRESET_SEED_BY_NAME.get(promptId)
  if (!seed || content === seed.content) {
    return content
  }
  const matchesSeed = languageList.some(
    (language) => content === resolveAiPromptContent(seed.content, language.value)
  )
  return matchesSeed ? seed.content : content
}

/**
 * True when a skill name ships with VidBee.
 *
 * @param name Standard skill name from storage or the UI.
 */
export const isAiPromptPresetName = (name: string): boolean => PRESET_NAMES.has(name)

/** Localize built-in metadata while keeping the standard name as the sole skill identifier. */
function localizedSkillField(
  prompt: Pick<AiPrompt, 'name' | 'isPreset' | 'description'>,
  field: 'name' | 'description',
  translate?: (key: string) => string
): string {
  const fallback = field === 'name' ? prompt.name : (prompt.description ?? '')
  if (
    !(prompt.isPreset && translate && BUILTIN_SKILLS.some((skill) => skill.name === prompt.name))
  ) {
    return fallback
  }
  const key = `settings.ai.presetSkills.${prompt.name}.${field}`
  const translated = translate(key)
  return translated === key ? fallback : translated
}

/** Show a localized built-in name without introducing another authored name or identifier. */
export function aiPromptLabel(
  prompt: Pick<AiPrompt, 'name' | 'isPreset' | 'description'>,
  translate?: (key: string) => string
): string {
  return localizedSkillField(prompt, 'name', translate)
}

/** Show localized built-in discovery descriptions in the skill library and composer. */
export function aiPromptDescription(
  prompt: Pick<AiPrompt, 'name' | 'isPreset' | 'description'>,
  translate?: (key: string) => string
): string {
  return localizedSkillField(prompt, 'description', translate)
}

/**
 * Build the default prompt list used on first launch.
 *
 * @param now Timestamp written onto createdAt/updatedAt.
 */
export const createDefaultAiPrompts = (now: number = Date.now()): AiPrompt[] =>
  AI_PROMPT_PRESETS.map((preset, index) => ({
    name: preset.name,
    description: preset.description,
    content: preset.content,
    autoRun: false,
    isPreset: true,
    sortOrder: index,
    createdAt: now,
    updatedAt: now
  }))

/**
 * Drop retired icon settings and refresh unedited built-in prompt bodies.
 *
 * @param stored Prompt loaded from storage.
 * @param now Timestamp written onto updatedAt when the body changes.
 */
const withCurrentPromptFields = (
  stored: AiPrompt & { icon?: unknown; enabled?: boolean },
  now: number
): AiPrompt => {
  let prompt: AiPrompt = stored
  if ('icon' in stored || 'enabled' in stored) {
    const { icon: _icon, enabled: _enabled, ...current } = stored
    prompt = current
  }
  if (!prompt.isPreset) {
    return prompt
  }
  const seed = PRESET_SEED_BY_NAME.get(prompt.name)
  const oldBodies = SUPERSEDED_PRESET_CONTENT[prompt.name]
  if (!(seed && oldBodies?.includes(prompt.content)) || prompt.content === seed.content) {
    return prompt
  }
  return { ...prompt, content: seed.content, updatedAt: now }
}

/** Resolve saved sidebar preferences while keeping custom skills on their existing defaults. */
export function isTranscriptSkillSidebarEnabled(prompt: AiPrompt): boolean {
  return (
    prompt.showInTranscript ??
    (prompt.isPreset ? DEFAULT_TRANSCRIPT_SIDEBAR_SKILLS.has(prompt.name) : !prompt.workflowOnly)
  )
}

/** Exclude invalid skills after resolving their transcript sidebar preference. */
export function isTranscriptSkillVisible(prompt: AiPrompt): boolean {
  return isTranscriptSkillSidebarEnabled(prompt) && !prompt.skillError
}

/**
 * Split the Overview prompt from the remaining visible prompt tabs.
 *
 * @param prompts Installed prompts shown in the transcript side panel.
 */
export const partitionTranscriptPromptTabs = (
  prompts: readonly AiPrompt[]
): { overview: AiPrompt | null; rest: AiPrompt[] } => {
  let overview: AiPrompt | null = null
  const rest: AiPrompt[] = []
  for (const prompt of prompts) {
    if (!isTranscriptSkillVisible(prompt)) {
      continue
    }
    if (prompt.name === AI_OVERVIEW_PROMPT_ID && !overview) {
      overview = prompt
      continue
    }
    rest.push(prompt)
  }
  return { overview, rest }
}

/**
 * Re-insert any missing built-in prompts without overwriting user edits,
 * refresh unedited official prompt bodies to the current seed, and drop
 * retired icon settings and built-in ids so they are not restored.
 *
 * @param existing Prompts already in storage.
 * @param now Timestamp for newly inserted or refreshed presets.
 */
export const mergeDefaultAiPrompts = (
  existing: AiPrompt[],
  now: number = Date.now()
): AiPrompt[] => {
  const kept = existing.filter((prompt) => !DEPRECATED_PRESET_NAMES.has(prompt.name))
  const present = new Set(kept.map((prompt) => prompt.name))
  const missing = createDefaultAiPrompts(now).filter((prompt) => !present.has(prompt.name))
  const refreshed = kept.map((prompt) => withCurrentPromptFields(prompt, now))
  const fieldsChanged = refreshed.some((prompt, index) => prompt !== kept[index])
  if (missing.length === 0 && kept.length === existing.length && !fieldsChanged) {
    return existing
  }
  const overviewMissing = missing.find((prompt) => prompt.name === AI_OVERVIEW_PROMPT_ID)
  const otherMissing = missing.filter((prompt) => prompt.name !== AI_OVERVIEW_PROMPT_ID)
  const nextSort = refreshed.reduce((max, prompt) => Math.max(max, prompt.sortOrder), -1) + 1
  const minSort = refreshed.reduce((min, prompt) => Math.min(min, prompt.sortOrder), 0)
  return [
    ...(overviewMissing ? [{ ...overviewMissing, sortOrder: minSort - 1 }] : []),
    ...refreshed,
    ...otherMissing.map((prompt, index) => ({ ...prompt, sortOrder: nextSort + index }))
  ]
}
