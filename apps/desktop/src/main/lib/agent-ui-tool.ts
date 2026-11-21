import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { type AgentUiSpec, agentUiSpecSchema, agentUiToolJsonSchema } from '../../shared/agent-ui'
import type { AgentToolContext } from './agent-tools'
import { defineAgentTool } from './agent-tools'

/** Present validated json-render cards without mutating application state or waiting inside a run. */
export function createAgentUiTool(context: AgentToolContext): AgentTool {
  return defineAgentTool(
    context,
    'show_ui',
    'Show VidBee cards: AgentProgress for a user-facing goal and plan, live TaskCard for one queue task, completed-file TaskPicker, single/multi ChoiceCard, MediaSettings, InfoCard, or Stack for grouping. For long multi-step work, show AgentProgress with {title,steps:[{id,label,status:pending|running|completed}]}; every progress call must include the full steps list, which remains available after completion. Use a few meaningful stages such as finding sources, selecting insights and writing an outline, never tool calls or a copy of the thinking trace. Update the same card by sending AgentProgress alone at meaningful stage changes; include completed and unfinished steps with stable IDs; omit title to retain it. Update step statuses before finishing so the saved steps reflect the work actually completed. Do not refresh it for every tool call or percentage update. The app automatically supplies real task progress and overall run state. This read-only card does not request input: continue executing after displaying or updating it. Use real task IDs and match the user language. ChoiceCard options use {label,value,description?}. A single choice card needs only {root:"card",elements:{card:{type:"ChoiceCard",props:{title:"Question",options:[{label:"A",value:"a"},{label:"B",value:"b"}]},children:[]}}}. Ask missing URLs/free text in prose first. At most one interactive question per reply, which ends automatically after this tool succeeds; wait for the user. No closing prose, selection or approval is implied. At most 3 presentations per reply; in-place plan updates do not add presentations.',
    Type.Unsafe<AgentUiSpec>(agentUiToolJsonSchema()),
    async (input, callId) => {
      const spec = agentUiSpecSchema.parse(input)
      if (!context.onUi) {
        throw new Error('Interactive cards are not available in this conversation')
      }
      context.onUi(callId, spec)
      return {
        content: [
          {
            type: 'text',
            text: 'Cards displayed or updated. No selection or application action has occurred. If a choice is required, finish this reply and wait for the user. Read-only progress cards do not require input; continue the requested work.'
          }
        ],
        details: { displayed: true }
      }
    }
  )
}
