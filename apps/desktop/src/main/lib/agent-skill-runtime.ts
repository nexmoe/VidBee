import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { createBashTool, createReadTool } from '@earendil-works/pi-durable/tools'
import { agentSkillTextParts } from '@vidbee/ui/lib/agent-skill-text'
import { agentNativeTool } from './agent-durable-tools'
import type { Skill } from './agent-session-types'
import { parseAgentSkill } from './agent-skill-document'
import { APPROVAL_DENIED_RESULT } from './agent-tool-approval'
import type { AgentToolContext } from './agent-tools'

/** Translate an explicit skill mention into Pi's native command without reading or expanding it here. */
export function agentSkillCommand(text: string, skills: Pick<Skill, 'name'>[]): string {
  if (text.startsWith('/skill:')) {
    return text
  }
  const available = new Map(skills.map((skill) => [skill.name, skill]))
  const mention = agentSkillTextParts(text, (name) => available.get(name), available.keys()).find(
    (part) => part.skill
  )
  return mention?.skill ? `/skill:${mention.skill.name} ${text}` : text
}

/** Bridge names containing spaces that Pi's command parser would otherwise truncate. */
export async function agentSkillInput(text: string, skills: Skill[]): Promise<string> {
  const command = agentSkillCommand(text, skills)
  if (!command.startsWith('/skill:')) {
    return command
  }
  const skill = [...skills]
    .sort((a, b) => b.name.length - a.name.length)
    .find(
      (candidate) =>
        command === `/skill:${candidate.name}` || command.startsWith(`/skill:${candidate.name} `)
    )
  if (!skill) {
    return command
  }
  const body = parseAgentSkill(await readFile(skill.filePath, 'utf8')).body
  const block = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`
  const args = command.slice(7 + skill.name.length).trim()
  return args ? `${block}\n\n${args}` : block
}

/** Use Durable's native file reader and shell while retaining application execution approvals. */
export async function createAgentSkillTools(options: {
  cwd: string
  signal: AbortSignal
  requestApproval?: AgentToolContext['requestApproval']
  shellEnabled?: boolean
  permissionApproved?: (id: string) => boolean
}): Promise<AgentTool[]> {
  const read = agentNativeTool(createReadTool(), options.cwd, options.signal)
  const { requestApproval } = options
  if (!(requestApproval || options.shellEnabled)) {
    return [read]
  }
  const bash = createBashTool()
  const shell: typeof bash = {
    ...bash,
    /** Request permission before dispatching the SDK's unchanged shell execution. */
    execute: async (params, api, context) => {
      const id = api.callId
      const executionSignal = AbortSignal.any([
        options.signal,
        ...(context.abortSignal ? [context.abortSignal] : [])
      ])
      executionSignal.throwIfAborted()
      const decision = options.permissionApproved
        ? { approved: options.permissionApproved(id) }
        : await requestApproval?.(id, {
            action: 'shell.execute',
            summary: `Run shell command: ${params.command}`,
            risk: 'destructive'
          })
      executionSignal.throwIfAborted()
      if (!decision?.approved) {
        return {
          output: APPROVAL_DENIED_RESULT.content,
          details: APPROVAL_DENIED_RESULT.details,
          isError: true
        }
      }
      return bash.execute(params, api, context)
    }
  }
  return [read, agentNativeTool(shell, options.cwd, options.signal)]
}

/** Load only the profile's explicitly selected portable skill files. */
export async function loadAgentSkills(paths: string[]): Promise<Skill[]> {
  return Promise.all(
    paths.map(async (filePath) => {
      const skill = parseAgentSkill(await readFile(filePath, 'utf8'))
      return {
        name: skill.name,
        description: skill.description,
        filePath,
        baseDir: dirname(filePath),
        disableModelInvocation: skill.frontmatter?.['disable-model-invocation'] === true
      }
    })
  )
}

/** Expose descriptions and locations without preloading private skill instructions. */
export function agentSkillCatalog(skills: Skill[]): string {
  const catalog = skills
    .filter((skill) => !skill.disableModelInvocation)
    .map(
      (skill) =>
        `<skill>\n<name>${skill.name}</name>\n<description>${skill.description}</description>\n<location>${skill.filePath}</location>\n</skill>`
    )
    .join('\n')
  return catalog ? `<available_skills>\n${catalog}\n</available_skills>` : ''
}

/** Annotate native read events for the UI without adding a separate skill execution protocol. */
export function agentSkillRead(skills: Skill[], cwd: string, path: string) {
  const file = resolve(cwd, path)
  for (const skill of skills) {
    const resource = relative(skill.baseDir, file)
    if (resource && !resource.startsWith('..') && !isAbsolute(resource)) {
      return {
        name: skill.name,
        description: skill.description,
        resource: resource.replaceAll('\\', '/')
      }
    }
  }
  return undefined
}
