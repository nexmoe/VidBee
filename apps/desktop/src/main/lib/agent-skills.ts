import { AI_OVERVIEW_PROMPT_ID } from '../../shared/ai-prompts'
import articleRewriteSkill from './agent-skills/article-rewrite/SKILL.md?raw'
import faqSkill from './agent-skills/faq/SKILL.md?raw'
import overviewSkill from './agent-skills/overview/SKILL.md?raw'

export interface AgentSkill {
  name: string
  description: string
  body: string
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/

/** Parse a SKILL.md document into name, description, and instruction body. */
export function parseAgentSkill(markdown: string): AgentSkill {
  const fence = markdown.match(FRONTMATTER)
  const fields: Record<string, string> = {}
  for (const line of (fence?.[1] ?? '').split('\n')) {
    const separator = line.indexOf(':')
    if (separator > 0) {
      fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
    }
  }
  return {
    name: fields.name ?? '',
    description: fields.description ?? '',
    body: markdown.slice(fence?.[0].length ?? 0).trim()
  }
}

export const AGENT_SKILLS = {
  overview: parseAgentSkill(overviewSkill),
  articleRewrite: parseAgentSkill(articleRewriteSkill),
  faq: parseAgentSkill(faqSkill)
} as const

/**
 * Load only the workflow skill for this tab. Tools stay registered separately.
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

/** One selected skill body for the system prompt. Empty when none applies. */
export function formatAgentSkillsForPrompt(skills: AgentSkill[]): string {
  return skills
    .map((skill) => `Skill (${skill.name}): ${skill.description}\n${skill.body}`)
    .join('\n\n')
}
