import path from 'node:path'
import type { AgentApprovalAction, AgentApprovalRequest } from '../../shared/agent-chat'

export type ApprovalAction = AgentApprovalAction
export type ApprovalRequest = AgentApprovalRequest

export type AgentManagementMode = 'off' | 'ask' | 'auto'

const TASK_ACTIONS: Record<string, ApprovalAction | null> = {
  pause: null,
  resume: null,
  retry: null,
  cancel: 'task.cancel',
  remove: 'task.remove',
  rename: 'task.rename',
  rename_file: 'task.rename_file'
}

const SUBSCRIPTION_ACTIONS: Record<string, ApprovalAction | null> = {
  add: 'subscription.add',
  update: 'subscription.update',
  remove: 'subscription.remove',
  refresh: null,
  items: null,
  queue_item: null
}

/**
 * Pure classification; returns null for auto-allowed calls.
 *
 * @param tool Tool name from the registry.
 * @param params Validated tool arguments.
 */
export function requiredApproval(tool: string, params: unknown): ApprovalRequest | null {
  const record = params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
  if (tool === 'create_task') {
    const url = typeof record.url === 'string' ? record.url : ''
    return {
      action: 'task.create',
      summary: url ? `Create a download task for ${url}` : 'Create a queued task',
      risk: 'network'
    }
  }
  if (tool === 'manage_task') {
    const action = typeof record.action === 'string' ? TASK_ACTIONS[record.action] : undefined
    if (!action) {
      return null
    }
    const id = typeof record.id === 'string' ? record.id : 'this task'
    const name = typeof record.name === 'string' ? record.name : ''
    return {
      action,
      summary:
        action === 'task.rename' || action === 'task.rename_file'
          ? `Rename ${id}${name ? ` to “${name}”` : ''}`
          : `${labelAction(action)} ${id}`,
      risk: action === 'task.remove' || action === 'task.cancel' ? 'destructive' : 'config'
    }
  }
  if (tool === 'manage_subscription') {
    const action =
      typeof record.action === 'string' ? SUBSCRIPTION_ACTIONS[record.action] : undefined
    if (!action) {
      return null
    }
    const target =
      (typeof record.url === 'string' && record.url) ||
      (typeof record.id === 'string' && record.id) ||
      'this subscription'
    const directory =
      typeof record.downloadDirectory === 'string' ? ` into ${record.downloadDirectory}` : ''
    return {
      action,
      summary: `${labelAction(action)} ${target}${directory}`,
      risk: action === 'subscription.remove' ? 'destructive' : 'config'
    }
  }
  return null
}

/**
 * True when the gate can skip the interactive card.
 *
 * Path targets outside the library always require a click, including auto mode.
 *
 * @param input.request Classified action.
 * @param input.mode User setting for management tools.
 * @param input.grants Actions this thread already remembered.
 * @param input.pathRequiresInteractive Hard filesystem rule.
 */
export function autoApprove(input: {
  request: ApprovalRequest
  mode: AgentManagementMode
  grants: Iterable<string>
  pathRequiresInteractive: boolean
}): boolean {
  if (input.mode === 'off' || input.pathRequiresInteractive) {
    return false
  }
  if (input.mode === 'auto') {
    return true
  }
  return [...input.grants].includes(input.request.action)
}

/**
 * True when a subscription download directory sits outside the user's library root.
 *
 * @param downloadDirectory Requested absolute path, if any.
 * @param downloadPath Configured downloads root.
 */
export function isOutsideDownloadPath(
  downloadDirectory: string | undefined,
  downloadPath: string
): boolean {
  if (!(downloadDirectory && downloadPath)) {
    return false
  }
  const resolved = path.resolve(downloadDirectory)
  const root = path.resolve(downloadPath)
  return resolved !== root && !resolved.startsWith(`${root}${path.sep}`)
}

/**
 * Hard filesystem rule: an out-of-tree downloadDirectory always needs interactive approval.
 *
 * @param tool Tool name from the registry.
 * @param params Validated tool arguments.
 * @param downloadPath Configured downloads root.
 */
export function requiresInteractivePathApproval(
  tool: string,
  params: unknown,
  downloadPath: string
): boolean {
  if (tool !== 'manage_subscription') {
    return false
  }
  const record = params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
  return (
    typeof record.downloadDirectory === 'string' &&
    isOutsideDownloadPath(record.downloadDirectory, downloadPath)
  )
}

/**
 * Denied-tool result returned to the model. Do not retry without new user instruction.
 */
export const APPROVAL_DENIED_RESULT = {
  content: [
    {
      type: 'text' as const,
      text: 'The user declined this action. Do not retry it without new user instruction.'
    }
  ],
  details: { denied: true },
  isError: true
}

/**
 * Human-readable verb for an approval action.
 *
 * @param action Gated management action.
 */
function labelAction(action: ApprovalAction): string {
  switch (action) {
    case 'task.create':
      return 'Create task'
    case 'task.cancel':
      return 'Cancel'
    case 'task.remove':
      return 'Remove'
    case 'task.rename':
      return 'Rename'
    case 'task.rename_file':
      return 'Rename file of'
    case 'subscription.add':
      return 'Add subscription'
    case 'subscription.update':
      return 'Update subscription'
    case 'subscription.remove':
      return 'Remove subscription'
    default:
      return action
  }
}
