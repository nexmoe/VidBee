import {
  FEEDBACK_EMAIL,
  FEEDBACK_GITHUB_URL,
  FEEDBACK_REPORT_FILENAME
} from '@vidbee/ui/lib/feedback-diagnostics'
import { AI_OVERVIEW_PROMPT_ID } from '../../shared/ai-prompts'
import { BUILTIN_SKILLS } from '../../shared/builtin-skills'
import { type AgentSkill, parseAgentSkill } from './agent-skill-document'

/** Read the repository's canonical skill document without keeping a second prompt definition. */
function document(name: string): string {
  const skill = BUILTIN_SKILLS.find((item) => item.name === name)
  if (!skill) {
    throw new Error(`Missing built-in skill: ${name}`)
  }
  return skill.document
}

export const AGENT_SKILLS = {
  overview: parseAgentSkill(document('overview')),
  articleRewrite: parseAgentSkill(document('article-rewrite')),
  faq: parseAgentSkill(document('faq')),
  videoLocalization: parseAgentSkill(document('video-localization')),
  diagnoseTask: parseAgentSkill(
    document('diagnose-task')
      .replaceAll('{{feedback.github}}', FEEDBACK_GITHUB_URL)
      .replaceAll('{{feedback.email}}', FEEDBACK_EMAIL)
      .replaceAll('{{feedback.filename}}', FEEDBACK_REPORT_FILENAME)
  )
} as const

/**
 * Pick the workflow for this tab, defaulting rewrites and detailed chat to the article skill.
 * Overview keeps its text-only product rules; FAQ and illustrated rewrites do not share one skill.
 */
export function selectAgentSkills(input: {
  promptId?: string
  mediaEnabled?: boolean
}): AgentSkill[] {
  if (input.promptId === AI_OVERVIEW_PROMPT_ID || input.mediaEnabled === false) {
    return [AGENT_SKILLS.overview]
  }
  if (input.promptId === 'generate-faq') {
    return [AGENT_SKILLS.faq]
  }
  return [AGENT_SKILLS.articleRewrite]
}

/** Inline the selected skill body so its workflow reaches the model without tool discovery. */
export function formatAgentSkillsForPrompt(skills: AgentSkill[]): string {
  return skills
    .map((skill) => `Skill (${skill.name}): ${skill.description}\n${skill.body}`)
    .join('\n\n')
}
