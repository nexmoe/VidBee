import './agent-skill-badge.css'

import { type AgentSkillLabel, agentSkillDisplayName } from '../lib/agent-skill-text'
import { agentMentionTextParts } from '../lib/agent-video-text'

/** Show explicitly referenced videos and skills in the user bubble, including the sidebar's initial invocation. */
export function AgentUserPrompt({
  text,
  initialSkill,
  skills = [],
  t
}: {
  text: string
  initialSkill?: string
  skills?: readonly (AgentSkillLabel & { isPreset?: boolean })[]
  t: (key: string) => string
}) {
  if (!(text || initialSkill)) {
    return null
  }
  const available = new Map(skills.map((skill) => [skill.name, skill]))
  /** Keep valid built-in references readable even before the managed catalog is hydrated. */
  function resolve(name: string): AgentSkillLabel | undefined {
    const skill = available.get(name)
    if (skill) {
      return { name, label: agentSkillDisplayName(skill, t) }
    }
    const label = agentSkillDisplayName({ name }, t)
    return label !== name || name === initialSkill ? { name, label } : undefined
  }
  const parts = agentMentionTextParts(text === initialSkill ? '' : text, resolve, [
    ...available.keys(),
    ...(initialSkill ? [initialSkill] : [])
  ])
  const prepend = initialSkill && !parts.some((part) => part.skill?.name === initialSkill)
  return (
    <p className="whitespace-pre-wrap" dir="auto">
      {prepend ? (
        <>
          <span className="agent-skill-badge" data-skill-name={initialSkill}>
            {agentSkillDisplayName(available.get(initialSkill) ?? { name: initialSkill }, t)}
          </span>
          {parts.length ? ' ' : ''}
        </>
      ) : null}
      {parts.map((part) =>
        part.video ? (
          <span
            className="agent-skill-badge agent-video-badge"
            data-video-token={part.text}
            key={part.start}
          >
            {part.video.title}
          </span>
        ) : part.skill ? (
          <span className="agent-skill-badge" data-skill-name={part.skill.name} key={part.start}>
            {part.skill.label ?? part.skill.name}
          </span>
        ) : (
          <span key={part.start}>{part.text}</span>
        )
      )}
    </p>
  )
}
