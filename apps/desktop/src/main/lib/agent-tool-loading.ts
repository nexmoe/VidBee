import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { AGENT_SKILLS } from './agent-skills'

/** Always-active evidence and conversation tools. */
export const CORE_AGENT_TOOLS = [
  'get_video_info',
  'read_transcript',
  'search_transcript',
  'list_transcripts',
  'select_transcript',
  'read_history',
  'search_history',
  'read_notes',
  'write_notes',
  'rename_conversation'
] as const

const TOOL_SUMMARIES: Record<string, string> = {
  capture_frames: 'Extract screenshots at source timestamps.',
  create_clip: 'Cut an MP4 clip from this video.',
  read_artifact: 'Reopen a saved image by artifact ID.',
  review_article: 'Fact-check a draft against this transcript.',
  write_article: 'Hand off a long rewrite to section writers.',
  create_task: 'Queue a download, conversion, or transcription.',
  manage_task: 'Pause, cancel, retry, remove, or rename a task.',
  list_tasks: 'Find tasks by ID, title, URL, kind, or status.',
  get_task: 'Inspect one task, progress, and latest logs.',
  list_subscriptions: 'Find saved subscriptions by title or URL.',
  test_subscription: 'Fetch a feed URL without saving it.',
  manage_subscription: 'Add, update, remove, or queue a subscription.',
  get_settings: 'Read current application settings.',
  update_settings: 'Change user-requested application settings.',
  manage_ai_settings: 'Configure AI providers and prompts.',
  manage_asr_model: 'Download or select a local ASR model.'
}

/**
 * One-line catalog summary for a lazy tool, truncated to 90 characters.
 *
 * @param tool Tool definition from the registry.
 */
export function agentToolSummary(tool: AgentTool): string {
  const named = TOOL_SUMMARIES[tool.name]
  if (named) {
    return named.slice(0, 90)
  }
  const sentence = tool.description.split(/[.!?]/)[0]?.trim() ?? tool.name
  return sentence.slice(0, 90)
}

/** Load only named tools and workflow instructions needed for the current request. */
export function createAgentToolLoading(
  tools: AgentTool[],
  signal: AbortSignal,
  options?: { initialActive?: string[] }
) {
  const available = new Set(tools.map((tool) => tool.name))
  const skills = Object.values(AGENT_SKILLS)
  const loaded = new Set<string>()
  let activate: ((names: string[]) => void) | undefined
  const core = (options?.initialActive ?? [...CORE_AGENT_TOOLS]).filter(
    (name) => available.has(name) && name !== 'load_tools'
  )
  const lazy = tools.filter((tool) => !core.includes(tool.name))
  const catalog = lazy.map((tool) => `${tool.name} — ${agentToolSummary(tool)}`).join('; ')
  const loader: AgentTool = {
    name: 'load_tools',
    label: 'load_tools',
    description: `Load named tools or workflow instructions, then call tools on the NEXT turn. Loading performs no application action. Additional tools: ${catalog || 'none'}. Workflows: ${skills.map((skill) => `${skill.name}: ${skill.description}`).join('; ')}. Use workflows only when their purpose matches the current request.`,
    parameters: Type.Object(
      {
        tools: Type.Optional(
          Type.Array(Type.String(), {
            description: 'Tool names from the Tools catalog.',
            minItems: 1,
            uniqueItems: true
          })
        ),
        skills: Type.Optional(
          Type.Array(Type.Union(skills.map((skill) => Type.Literal(skill.name))), {
            description: 'Workflow names only; application tools belong in tools.',
            minItems: 1,
            uniqueItems: true
          })
        )
      },
      { additionalProperties: false, minProperties: 1 }
    ),
    executionMode: 'sequential',
    /** Validate the whole request before changing the active tool set. */
    execute: async (_id, params, callSignal) => {
      signal.throwIfAborted()
      callSignal?.throwIfAborted()
      if (!activate) {
        throw new Error('Tool loading is not connected to a session')
      }
      const input = params as { tools?: string[]; skills?: string[] }
      const requested = input.tools ?? []
      const requestedSkills = input.skills ?? []
      if (!(requested.length || requestedSkills.length)) {
        throw new Error('Specify tools or skills')
      }
      for (const name of requested) {
        if (!available.has(name)) {
          throw new Error(`Unavailable tool: ${name}`)
        }
      }
      const workflows = requestedSkills.map((name) => {
        const skill = skills.find((item) => item.name === name)
        if (!skill) {
          throw new Error(`Unavailable skill: ${name}`)
        }
        return { name: skill.name, instructions: skill.body }
      })
      const addedToolNames = requested.filter((name) => !(loaded.has(name) || core.includes(name)))
      const next = new Set([...core, ...loaded, ...requested])
      activate(['load_tools', ...next])
      for (const name of requested) {
        loaded.add(name)
      }
      const details = { loaded: requested, workflows }
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details, addedToolNames }
    }
  }
  return {
    initial: [...tools.filter((tool) => core.includes(tool.name)), loader],
    all: [...tools, loader],
    /** Bind after the complete permitted registry has been installed. */
    bind(callback: (names: string[]) => void): void {
      activate = callback
    }
  }
}
