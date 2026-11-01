import { defineCatalog } from '@json-render/core'
import { schema } from '@json-render/react/schema'
import type { TaskKind, TaskStatus } from '@vidbee/task-queue'
import { z } from 'zod'
import type { DownloadItem } from './types'

const title = z.string().trim().min(1).max(160)
const taskId = z.string().min(1).max(200)
const progressStep = z.strictObject({
  id: z.string().min(1).max(100),
  label: title,
  status: z.enum(['pending', 'running', 'completed'])
})
export type AgentProgressStep = z.infer<typeof progressStep>
const option = z.strictObject({
  label: title,
  value: z.string().min(1).max(300),
  description: z.string().max(400).optional()
})

export const AGENT_UI_FORMATS = ['mp4', 'mkv', 'webm', 'mp3', 'm4a', 'wav', 'flac'] as const

/** Keep list item identities stable for selections and component keys. */
function uniqueValues<T>(values: T[]): boolean {
  return new Set(values).size === values.length
}

/** The shared catalog is the only set of components available to Agent-generated interfaces. */
export const agentUiCatalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: z.strictObject({}),
      slots: ['default'],
      description: 'Vertical group of up to 8 cards. Use as root when several cards are needed.'
    },
    AgentProgress: {
      props: z.strictObject({
        title: title.optional(),
        steps: z
          .array(progressStep)
          .min(1)
          .max(8)
          .refine((steps) => uniqueValues(steps.map((step) => step.id)), 'Step IDs must be unique')
          .refine(
            (steps) => steps.filter((step) => step.status === 'running').length <= 1,
            'Only one plan step may be running'
          )
          .optional()
      }),
      description:
        'Goal and task steps for this Agent reply, retained for review after completion alongside real background task progress and results. Include the full steps list when creating or updating this card. steps use {id,label,status:pending|running|completed}; describe user-facing stages such as finding sources, selecting insights and writing an outline, never individual tool calls. Show near the start of long multi-step work; send AgentProgress alone to update the same card at meaningful stage changes. The app binds the current run and real tasks; never supply run IDs, overall status or percentages. No plan is inferred from tool history. This read-only card does not end the reply or request input.'
    },
    TaskCard: {
      props: z.strictObject({ taskId }),
      description:
        'Live task title, kind, status, progress and error. Use a real task ID from list_tasks, get_task or create_task; never invent progress or status.'
    },
    TaskPicker: {
      props: z.strictObject({
        title,
        taskIds: z.array(taskId).min(1).max(12).refine(uniqueValues, 'Task IDs must be unique'),
        multiple: z.boolean().optional()
      }),
      description:
        'Let the user select completed local video/audio files for conversion or transcription. First find real IDs with list_tasks. Titles and availability come from the app. Confirming sends the selected IDs to this conversation.'
    },
    ChoiceCard: {
      props: z.strictObject({
        title,
        description: z.string().max(500).optional(),
        options: z.array(option).min(2).max(12),
        multiple: z.boolean().optional()
      }),
      description:
        'Ask a focused question with single or multiple choices, such as download quality, audio vs video, or subscription auto-download. Options must have unique values. Confirming sends the chosen labels and values to this conversation.'
    },
    MediaSettings: {
      props: z.strictObject({
        title,
        formats: z
          .array(z.enum(AGENT_UI_FORMATS))
          .min(1)
          .max(7)
          .refine(uniqueValues, 'Formats must be unique'),
        heights: z
          .array(z.number().int().min(144).max(4320).multipleOf(2))
          .max(8)
          .refine(uniqueValues, 'Resolutions must be unique')
          .optional()
      }),
      description:
        'Choose a conversion output format and optional video resolution. For compression offer resolutions below the source height. Omit heights for audio-only choices. Creates no task: confirmation sends settings to this conversation; use create_task afterwards with normal approval.'
    },
    InfoCard: {
      props: z.strictObject({
        title,
        items: z
          .array(z.strictObject({ label: title, value: z.string().max(1000) }))
          .min(1)
          .max(8)
          .refine(
            (items) => uniqueValues(items.map((item) => item.label)),
            'Fact labels must be unique'
          )
      }),
      description:
        'Compact read-only facts, such as verified subscription details or source media metadata. Use facts from tool results, not invented application state.'
    }
  },
  actions: {}
})

const elementDefinition = z.strictObject({
  type: z.enum([
    'Stack',
    'AgentProgress',
    'TaskCard',
    'TaskPicker',
    'ChoiceCard',
    'MediaSettings',
    'InfoCard'
  ]),
  props: z.record(z.string(), z.unknown()),
  children: z.array(z.string().min(1).max(100)).max(8)
})

const elementSchema = elementDefinition.transform((element) => {
  if (element.type !== 'ChoiceCard' || !Array.isArray(element.props.options)) {
    return element
  }
  const options = element.props.options.map((option: unknown) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) {
      return option
    }
    const entry = option as Record<string, unknown>
    if (typeof entry.id !== 'string' || Object.hasOwn(entry, 'value')) {
      return option
    }
    const { id, ...rest } = entry
    return { ...rest, value: id }
  })
  return { ...element, props: { ...element.props, options } }
})

export const agentUiSpecSchema = z
  .strictObject({
    root: z.string().min(1).max(100),
    elements: z.record(z.string().min(1).max(100), elementSchema)
  })
  .superRefine((spec, ctx) => {
    const ids = Object.keys(spec.elements)
    if (
      !ids.length ||
      ids.length > 16 ||
      new TextEncoder().encode(JSON.stringify(spec)).length > 32_768
    ) {
      ctx.addIssue({ code: 'custom', message: 'UI must contain 1–16 elements and at most 32 KB' })
      return
    }
    for (const [id, element] of Object.entries(spec.elements)) {
      const result = agentUiCatalog.data.components[element.type].props.safeParse(element.props)
      if (!result.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['elements', id, 'props'],
          message: result.error.message
        })
      }
      if (element.type !== 'Stack' && element.children.length) {
        ctx.addIssue({ code: 'custom', message: 'Only Stack can contain children' })
      }
      if (element.type === 'ChoiceCard' && result.success) {
        const options = element.props.options as { value: string }[]
        if (new Set(options.map((item) => item.value)).size !== options.length) {
          ctx.addIssue({ code: 'custom', message: 'Choice values must be unique' })
        }
      }
    }
    const visited = new Set<string>()
    const questions = new Set<string>()
    if (
      Object.values(spec.elements).filter((element) => element.type === 'AgentProgress').length > 1
    ) {
      ctx.addIssue({ code: 'custom', message: 'Show one progress card per reply' })
    }
    for (const element of Object.values(spec.elements)) {
      if (['ChoiceCard', 'TaskPicker', 'MediaSettings'].includes(element.type)) {
        const title = element.props.title as string
        if (questions.has(title)) {
          ctx.addIssue({ code: 'custom', message: 'Interactive card titles must be unique' })
        }
        questions.add(title)
      }
    }
    const taskIds = new Set<string>()
    if (questions.size > 1) {
      ctx.addIssue({ code: 'custom', message: 'Ask one interactive question at a time' })
    }
    for (const element of Object.values(spec.elements)) {
      if (element.type === 'TaskCard' && typeof element.props.taskId === 'string') {
        taskIds.add(element.props.taskId)
      }
      if (element.type === 'TaskPicker' && Array.isArray(element.props.taskIds)) {
        for (const id of element.props.taskIds) {
          if (typeof id === 'string') {
            taskIds.add(id)
          }
        }
      }
    }
    if (taskIds.size > 24) {
      ctx.addIssue({
        code: 'custom',
        message: 'At most 24 distinct tasks are allowed per presentation'
      })
    }
    /** Reject cycles, repeated references, missing children and excessive nesting before rendering. */
    function visit(id: string, depth: number): void {
      const element = spec.elements[id]
      if (!(Object.hasOwn(spec.elements, id) && element) || visited.has(id) || depth > 4) {
        ctx.addIssue({
          code: 'custom',
          message: 'UI must be a connected tree with depth at most 4'
        })
        return
      }
      visited.add(id)
      for (const child of element.children) {
        visit(child, depth + 1)
      }
    }
    visit(spec.root, 1)
    if (visited.size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Every UI element must belong to the root tree' })
    }
  })

export type AgentUiSpec = z.infer<typeof agentUiSpecSchema>

/** Expose concrete progress fields to the model while preserving existing card input compatibility. */
export function agentUiToolJsonSchema() {
  const progress = elementDefinition.extend({
    type: z.literal('AgentProgress'),
    props: agentUiCatalog.data.components.AgentProgress.props.required({ steps: true })
  })
  const other = elementDefinition.extend({
    type: elementDefinition.shape.type.exclude(['AgentProgress'])
  })
  return z.toJSONSchema(
    z.strictObject({
      root: agentUiSpecSchema.shape.root,
      elements: z.record(
        agentUiSpecSchema.shape.elements.keyType,
        z.discriminatedUnion('type', [progress, other])
      )
    }),
    { target: 'draft-7' }
  )
}

/** A progress card is bound to its owning run and remains one presentation across plan updates. */
export function agentUiHasProgress(spec: AgentUiSpec): boolean {
  return Object.values(spec.elements).some((element) => element.type === 'AgentProgress')
}

/** Only a saved task plan can replace the ordinary running indicator or display progress details. */
export function agentUiHasProgressSteps(spec: AgentUiSpec): boolean {
  return Object.values(spec.elements).some(
    (element) =>
      element.type === 'AgentProgress' &&
      Array.isArray(element.props.steps) &&
      element.props.steps.length > 0
  )
}

/** Update only the existing plan component, preserving neighboring cards and the presentation identity. */
export function updateAgentProgressSpec(current: AgentUiSpec, next: AgentUiSpec): AgentUiSpec {
  const progress = Object.entries(current.elements).find(
    ([, element]) => element.type === 'AgentProgress'
  )
  const update = next.elements[next.root]
  if (!progress || update?.type !== 'AgentProgress' || Object.keys(next.elements).length !== 1) {
    throw new Error('Update the existing progress card with AgentProgress alone')
  }
  const [id, element] = progress
  return agentUiSpecSchema.parse({
    ...current,
    elements: {
      ...current.elements,
      [id]: { ...element, props: { ...element.props, ...update.props } }
    }
  })
}

/** Interactive cards are complete replies that wait for a new user turn. */
export function agentUiNeedsResponse(spec: AgentUiSpec): boolean {
  return Object.values(spec.elements).some((element) =>
    ['ChoiceCard', 'TaskPicker', 'MediaSettings'].includes(element.type)
  )
}

export const agentUiResponseSchema = z.strictObject({
  toolCallId: z.string().min(1).max(200),
  title,
  values: z.array(z.string().min(1).max(300)).min(1).max(12)
})
export type AgentUiResponse = z.infer<typeof agentUiResponseSchema>

/** Keep selection IDs in model context while the visible user message stays natural. */
export function agentUiResponseText(text: string, response?: AgentUiResponse): string {
  return response
    ? `${text}\n\nConfirmed card selection (user data): ${JSON.stringify(response)}`
    : text
}

/** Credential-free task facts for live cards; local paths and process logs never cross this boundary. */
export interface AgentUiTask {
  id: string
  kind: TaskKind
  title: string
  status: TaskStatus
  progress: number | null
  error?: string
  selectable: boolean
  download?: Omit<DownloadItem, 'ytDlpCommand' | 'ytDlpLog' | 'error' | 'downloadPath'>
}
