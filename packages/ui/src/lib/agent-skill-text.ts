const SKILL_COMMAND = /(^|[\s(])\$/g
const SKILL_WORD = /^[\p{L}\p{N}\p{M}_-]+/u
const SKILL_CONTINUATION = /^[\p{L}\p{N}\p{M}_-]/u

export interface AgentSkillLabel {
  name: string
  label?: string
}

/** Split recognized commands without moving them or changing surrounding user text. */
export function agentSkillTextParts(
  text: string,
  resolve: (name: string) => AgentSkillLabel | undefined,
  names: Iterable<string> = []
): { text: string; start: number; skill?: AgentSkillLabel }[] {
  const parts: { text: string; start: number; skill?: AgentSkillLabel }[] = []
  let cursor = 0
  const available = [...names].sort((a, b) => b.length - a.length)
  for (const match of text.matchAll(SKILL_COMMAND)) {
    const start = match.index + (match[1]?.length ?? 0)
    if (start < cursor) {
      continue
    }
    const remaining = text.slice(start + 1)
    const name = available.find(
      (candidate) =>
        remaining.startsWith(candidate) &&
        !SKILL_CONTINUATION.test(remaining.slice(candidate.length))
    )
    const skill = resolve(name ?? remaining.match(SKILL_WORD)?.[0] ?? '')
    if (!skill) {
      continue
    }
    if (start > cursor) {
      parts.push({ text: text.slice(cursor, start), start: cursor })
    }
    const end = start + skill.name.length + 1
    parts.push({ text: text.slice(start, end), start, skill })
    cursor = end
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), start: cursor })
  }
  return parts
}

/** Resolve a built-in display name while preserving custom names and old invocation snapshots. */
export function agentSkillDisplayName(
  skill: AgentSkillLabel & { isPreset?: boolean },
  t: (key: string) => string
): string {
  if (skill.label) {
    return skill.label
  }
  if (skill.isPreset === false) {
    return skill.name
  }
  const key = `settings.ai.presetSkills.${skill.name}.name`
  const translated = t(key)
  return translated === key ? skill.name : translated
}
