import type { AgentThread } from '../../shared/agent-chat'
import { agentUiResponseSchema, agentUiSpecSchema } from '../../shared/agent-ui'
import { readAgentUiTasks } from './agent-ui-tasks'

/** Reject stale, forged, unavailable or out-of-range card answers before admitting a user turn. */
export function validateAgentUiResponse(thread: AgentThread, raw: unknown) {
  const response = agentUiResponseSchema.parse(raw)
  const message = thread.messages.find((item) => item.id === thread.leafId)
  const run = thread.runs.find((item) => item.id === message?.runId)
  const tool = run?.tools.find((item) => item.id === response.toolCallId)
  if (
    message?.role !== 'assistant' ||
    !tool?.ui ||
    tool.status !== 'completed' ||
    run?.status === 'running'
  ) {
    throw new Error('This card is no longer accepting answers')
  }
  const spec = agentUiSpecSchema.parse(tool.ui)
  const element = Object.values(spec.elements).find(
    (item) =>
      item.props.title === response.title &&
      ['ChoiceCard', 'TaskPicker', 'MediaSettings'].includes(item.type)
  )
  const values = response.values
  if (!element || new Set(values).size !== values.length) {
    throw new Error('Invalid card selection')
  }
  if (element.type === 'ChoiceCard') {
    const options = element.props.options as { value: string }[]
    if (
      (!element.props.multiple && values.length !== 1) ||
      values.some((value) => !options.some((item) => item.value === value))
    ) {
      throw new Error('Invalid choice')
    }
  } else if (element.type === 'TaskPicker') {
    const ids = element.props.taskIds as string[]
    if (
      (!element.props.multiple && values.length !== 1) ||
      values.some((id) => !ids.includes(id))
    ) {
      throw new Error('Invalid file selection')
    }
    const tasks = readAgentUiTasks(values)
    if (tasks.length !== values.length || tasks.some((task) => !task.selectable)) {
      throw new Error('The selected file is no longer available')
    }
  } else {
    const formats = element.props.formats as string[]
    const heights = element.props.heights as number[] | undefined
    const video = ['mp4', 'mkv', 'webm'].includes(values[0])
    if (
      !formats.includes(values[0]) ||
      values.length > 2 ||
      (values[1] !== undefined && !(video && heights?.includes(Number(values[1])))) ||
      (video && heights?.length && values.length !== 2)
    ) {
      throw new Error('Invalid media settings')
    }
  }
  return response
}
