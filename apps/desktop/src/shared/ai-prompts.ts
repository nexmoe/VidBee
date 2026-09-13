import { languageList, languages, normalizeLanguageCode } from '@vidbee/i18n/languages'
import type { AiPrompt, AiPromptIconId } from './ai-types'

/** Replaced with the current UI language name before a prompt is shown or sent. */
export const AI_PROMPT_UI_LANGUAGE_TOKEN = '{{uiLanguage}}'

/** Sample text used when testing a prompt from settings. */
export const AI_PROMPT_SAMPLE_TRANSCRIPT =
  'This is an example of some transcribed text. The speaker mentions a 23% increase in sign-ups last quarter, then asks how the team should follow up. People sound excited, but there is also some anxiety about the deadline.'

interface AiPromptPresetSeed {
  id: string
  title: string
  icon: AiPromptIconId
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

/** Freeform Agent conversation started from New chat, not shown as a prompt tab. */
export const AI_CHAT_PROMPT_ID = 'chat'

/** Instruction used when the user starts an empty Agent conversation. */
const AGENT_CHAT_CONTENT = [
  'Answer the user about this video.',
  'Use tools when you need transcript evidence, timestamps, screenshots, or clips.',
  'Do not invent quotes or timestamps.',
  'Once the topic is clear, call rename_conversation with a short title (a few words, in the user language). Do not mention renaming in your reply. Skip if the current title already fits.',
  'Follow the user’s requested output language; otherwise reply in the language of their latest message. Use {{uiLanguage}} only when the user’s language cannot be determined.'
].join('\n')

/**
 * Virtual prompt for a blank Agent chat. It is not stored in settings.
 *
 * @param now Timestamp written onto createdAt and updatedAt.
 */
export const agentChatPrompt = (now: number = Date.now()): AiPrompt => ({
  id: AI_CHAT_PROMPT_ID,
  title: 'Chat',
  icon: 'message-circle-question',
  content: AGENT_CHAT_CONTENT,
  enabled: true,
  isPreset: true,
  sortOrder: -1,
  createdAt: now,
  updatedAt: now
})

/**
 * Default transcript prompts. Titles are English seeds; the UI translates via
 * i18n keys under `settings.ai.presetPrompts`. `{{uiLanguage}}` is replaced
 * with the current interface language name before a prompt is shown or sent.
 */
export const AI_PROMPT_PRESETS: readonly AiPromptPresetSeed[] = [
  {
    id: AI_OVERVIEW_PROMPT_ID,
    title: 'Overview',
    icon: 'sparkles',
    content: [
      'Write a navigable, topic-by-topic overview of this transcript with chapters and key quotes.',
      '',
      'Each transcript line starts with [m:ss] or [h:mm:ss]. Read the whole transcript before selecting chapter boundaries. Cover the full timeline through the final substantive discussion, not just the opening or highlights. Use only timestamps present in the transcript, in chronological order without duplicates. Start each chapter at the first transcript line introducing its topic; do not invent timestamps or infer chapter end times.',
      '',
      'Choose chapters by meaningful topic changes: a new question, distinct argument, case study, story, technical mechanism, or trade-off that a viewer might want to revisit. Give each chapter one clear main topic and a specific title. Do not bundle several independently useful discussions under a broad label such as career, technology, or the future. If a theme returns later, keep that later discussion in its chronological position.',
      '',
      'For long, topic-rich interviews or lectures, use roughly 3-6 minutes per chapter as a guide. Review any chapter spanning more than 8 minutes for overlooked topic changes, including the final chapter. Split at real transitions when supported by the transcript. A genuinely continuous explanation may stay longer; do not divide into equal time intervals, split every short exchange, invent topics, or force a chapter count. Let chapter count grow with duration and topic density.',
      '',
      "Include 3-5 key quotes that are surprising, contrarian, memorable, or statistically striking. Quotes must be the speaker's words. Clean filler and transcription errors, but keep their voice.",
      '',
      'Output format:',
      '# {one-sentence takeaway}',
      '## Chapters',
      '- **{m:ss}** {specific topic title} — {what this section covers}',
      '## Key quotes',
      '- **{m:ss}** "{quote}"',
      '',
      'Use unordered lists only. Keep each bullet to one or two sentences. Skip empty sections. Output only the final overview; do not include planning, timestamp verification, checklists, or self-evaluation.',
      PRESET_FORMAT_RULES
    ].join('\n')
  },
  {
    id: 'bullet-points',
    title: 'Bullet Points',
    icon: 'list',
    content: [
      'Turn this transcript into a scannable bullet summary.',
      '',
      'Output format:',
      '# {theme}',
      '- {point}',
      '',
      'Group related points under # headings. Use unordered lists only. Keep each bullet to one sentence. Skip empty sections.',
      PRESET_FORMAT_RULES
    ].join('\n')
  },
  {
    id: 'improve-grammar',
    title: 'Improve Grammar & Punctuation',
    icon: 'spell-check',
    content: [
      'Correct grammar, spelling, and punctuation so the transcript reads naturally and professionally. Keep the original meaning, speakers, and details. Do not add new facts.',
      '',
      'Output format:',
      '# {speaker or topic}',
      '{cleaned paragraphs}',
      '',
      'Use # headings for speaker changes or topic shifts. Write cleaned prose in paragraphs. Use an unordered or ordered list only when the original content is already a list.',
      PRESET_FORMAT_RULES
    ].join('\n')
  },
  {
    id: 'generate-faq',
    title: 'Generate FAQ',
    icon: 'message-circle-question',
    content: [
      'Generate a FAQ from this transcript. Write clear questions and concise answers grounded only in the transcript. If the transcript does not contain an answer, say so.',
      '',
      'Output format:',
      '# {question}',
      '{answer}',
      '',
      'Use one # heading per question. Put the answer as a short paragraph, or as an unordered list when there are several parts. Do not number the questions or add a FAQ title.',
      PRESET_FORMAT_RULES
    ].join('\n')
  },
  {
    id: 'extract-statistics',
    title: 'Extract Statistics',
    icon: 'chart-no-axes-column',
    content: [
      'Extract numbers, percentages, amounts, dates, and growth rates from this transcript.',
      '',
      'Output format:',
      '# Highlights',
      '- {statistic} — {what it refers to}',
      '# Details',
      '| Statistic | Refers to | Context |',
      '| --- | --- | --- |',
      '| ... | ... | ... |',
      '',
      'Use an unordered list for highlights and a Markdown table for details. If none are found, say so in one short sentence. Do not add a Statistics title.',
      PRESET_FORMAT_RULES
    ].join('\n')
  },
  {
    id: 'paraphrase-content',
    title: 'Paraphrase Content',
    icon: 'repeat-2',
    content: [
      'Paraphrase this transcript in a clear, natural style while keeping the original meaning. Do not add claims that are not in the source.',
      '',
      'Output format:',
      '# {section}',
      '{paraphrased paragraphs}',
      '',
      'Use # headings for topic shifts. Prefer short paragraphs. Use an unordered list for parallel takeaways and an ordered list for steps or ranked items.',
      PRESET_FORMAT_RULES
    ].join('\n')
  },
  {
    id: 'create-mindmap',
    title: 'Create a mindmap',
    icon: 'git-branch',
    content: [
      'Organize this transcript into a hierarchical mind map.',
      '',
      'Output format:',
      '```mermaid',
      'mindmap',
      '  {root topic}',
      '    {branch}',
      '      {leaf}',
      '      {leaf}',
      '    {branch}',
      '      {leaf}',
      '```',
      '',
      'Reply with one mermaid code fence only. Start the diagram with mindmap. Indent two spaces per level. Keep labels short. Wrap a label in double quotes if it contains parentheses, brackets, or colons. Do not use flowchart or graph syntax. Do not add a heading, preamble, or extra text outside the fence. Use the same language as the transcript.'
    ].join('\n')
  },
  {
    id: 'translate',
    title: 'Translate',
    icon: 'languages',
    content: [
      `Translate this transcript into ${AI_PROMPT_UI_LANGUAGE_TOKEN}. If it is already in ${AI_PROMPT_UI_LANGUAGE_TOKEN}, rewrite it clearly without changing the meaning.`,
      '',
      'Output format:',
      '# {section}',
      '{translated paragraphs}',
      '',
      'Use # headings for speaker changes or topic shifts. Write translated prose in paragraphs. Use an unordered or ordered list only when the original content is already a list. Keep the original speakers, meaning, and details. Do not add claims that are not in the source. Keep each list marker on the same line as the item text. Do not wrap the whole reply in a code fence. Do not add a preamble, closing remarks, or a heading that restates the task.'
    ].join('\n')
  }
] as const

const PRESET_IDS = new Set(AI_PROMPT_PRESETS.map((prompt) => prompt.id))
const PRESET_SEED_BY_ID = new Map<string, AiPromptPresetSeed>(
  AI_PROMPT_PRESETS.map((preset) => [preset.id, preset])
)

/** Built-in prompts that should no longer be seeded or restored. */
const DEPRECATED_PRESET_IDS = new Set([
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
  const seed = PRESET_SEED_BY_ID.get(promptId)
  if (!seed || content === seed.content) {
    return content
  }
  const matchesSeed = languageList.some(
    (language) => content === resolveAiPromptContent(seed.content, language.value)
  )
  return matchesSeed ? seed.content : content
}

/**
 * True when a prompt id ships with VidBee.
 *
 * @param id Prompt id from storage or the UI.
 */
export const isAiPromptPresetId = (id: string): boolean => PRESET_IDS.has(id)

/**
 * Build the default prompt list used on first launch.
 *
 * @param now Timestamp written onto createdAt/updatedAt.
 */
export const createDefaultAiPrompts = (now: number = Date.now()): AiPrompt[] =>
  AI_PROMPT_PRESETS.map((preset, index) => ({
    id: preset.id,
    title: preset.title,
    icon: preset.icon,
    content: preset.content,
    enabled: true,
    isPreset: true,
    sortOrder: index,
    createdAt: now,
    updatedAt: now
  }))

/**
 * Replace a stored built-in prompt body when it still matches an older official seed.
 *
 * @param prompt Prompt loaded from storage.
 * @param now Timestamp written onto updatedAt when the body changes.
 */
const withCurrentPresetContent = (prompt: AiPrompt, now: number): AiPrompt => {
  if (!prompt.isPreset) {
    return prompt
  }
  const seed = PRESET_SEED_BY_ID.get(prompt.id)
  const oldBodies = SUPERSEDED_PRESET_CONTENT[prompt.id]
  if (!(seed && oldBodies?.includes(prompt.content)) || prompt.content === seed.content) {
    return prompt
  }
  return { ...prompt, content: seed.content, updatedAt: now }
}

/**
 * Split the Overview prompt from the remaining prompt tabs.
 *
 * @param prompts Enabled prompts shown in the transcript side panel.
 */
export const partitionTranscriptPromptTabs = (
  prompts: readonly AiPrompt[]
): { overview: AiPrompt | null; rest: AiPrompt[] } => {
  let overview: AiPrompt | null = null
  const rest: AiPrompt[] = []
  for (const prompt of prompts) {
    if (prompt.id === AI_OVERVIEW_PROMPT_ID && !overview) {
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
 * retired built-in ids so they are not restored.
 *
 * @param existing Prompts already in storage.
 * @param now Timestamp for newly inserted or refreshed presets.
 */
export const mergeDefaultAiPrompts = (
  existing: AiPrompt[],
  now: number = Date.now()
): AiPrompt[] => {
  const kept = existing.filter((prompt) => !DEPRECATED_PRESET_IDS.has(prompt.id))
  const present = new Set(kept.map((prompt) => prompt.id))
  const missing = createDefaultAiPrompts(now).filter((prompt) => !present.has(prompt.id))
  const refreshed = kept.map((prompt) => withCurrentPresetContent(prompt, now))
  const contentChanged = refreshed.some((prompt, index) => prompt !== kept[index])
  if (missing.length === 0 && kept.length === existing.length && !contentChanged) {
    return existing
  }
  const overviewMissing = missing.find((prompt) => prompt.id === AI_OVERVIEW_PROMPT_ID)
  const otherMissing = missing.filter((prompt) => prompt.id !== AI_OVERVIEW_PROMPT_ID)
  const nextSort = refreshed.reduce((max, prompt) => Math.max(max, prompt.sortOrder), -1) + 1
  const minSort = refreshed.reduce((min, prompt) => Math.min(min, prompt.sortOrder), 0)
  return [
    ...(overviewMissing ? [{ ...overviewMissing, sortOrder: minSort - 1 }] : []),
    ...refreshed,
    ...otherMissing.map((prompt, index) => ({ ...prompt, sortOrder: nextSort + index }))
  ]
}
