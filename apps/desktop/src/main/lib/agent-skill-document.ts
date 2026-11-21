import { parse, stringify } from 'yaml'

export interface AgentSkill {
  name: string
  description: string
  body: string
  /** Preserve optional standard fields and client extensions through UI edits. */
  frontmatter?: Record<string, unknown>
}

const UNSAFE_SKILL_NAME = /[/\\\p{Cc}]/u
const FRONTMATTER = /^---[\t ]*\n([\s\S]*?)\n---[\t ]*(?:\n|$)/
export const MAX_SKILL_BYTES = 128 * 1024

/** Keep names inside one directory without imposing a language or naming convention. */
export function validateAgentSkill(skill: AgentSkill): void {
  if (
    !skill.name.trim() ||
    skill.name === '.' ||
    skill.name === '..' ||
    UNSAFE_SKILL_NAME.test(skill.name)
  ) {
    throw new Error(
      'Skill names must be nonempty directory names without path separators or control characters'
    )
  }
  if (!skill.description.trim() || skill.description.length > 1024) {
    throw new Error('A skill description is required (up to 1024 characters)')
  }
  if (!skill.body.trim() || Buffer.byteLength(skill.body, 'utf8') > MAX_SKILL_BYTES) {
    throw new Error('Skill instructions are required and must fit within 128 KB')
  }
}

/** Parse standard YAML frontmatter, including quoted and multiline descriptions. */
export function parseAgentSkill(markdown: string): AgentSkill {
  if (Buffer.byteLength(markdown, 'utf8') > MAX_SKILL_BYTES) {
    throw new Error('SKILL.md must fit within 128 KB')
  }
  const normalized = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const fence = normalized.match(FRONTMATTER)
  if (!fence) {
    throw new Error('SKILL.md requires YAML frontmatter with name and description')
  }
  const parsed: unknown = parse(fence[1])
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Skill frontmatter must be a YAML mapping')
  }
  const frontmatter = parsed as Record<string, unknown>
  const body = normalized.slice(fence[0].length)
  const skill = {
    name: typeof frontmatter.name === 'string' ? frontmatter.name : '',
    description: typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '',
    body: body.trim(),
    frontmatter
  }
  validateAgentSkill(skill)
  return skill
}

/** Serialize portable SKILL.md without interpreting user-authored YAML characters. */
export function formatAgentSkillDocument(skill: AgentSkill): string {
  validateAgentSkill(skill)
  const frontmatter = { ...skill.frontmatter, name: skill.name, description: skill.description }
  const document = `---\n${stringify(frontmatter)}---\n\n${skill.body.trim()}\n`
  if (Buffer.byteLength(document, 'utf8') > MAX_SKILL_BYTES) {
    throw new Error('SKILL.md must fit within 128 KB')
  }
  return document
}
