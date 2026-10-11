import { lstatSync, readlinkSync, realpathSync } from 'node:fs'
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

/** Highest-risk field first so a combined patch keeps the stricter risk. */
const PROTECTED_SETTINGS = {
  configPath: {
    action: 'settings.config_path',
    risk: 'destructive',
    summary: 'Change the yt-dlp config file'
  },
  proxy: {
    action: 'settings.proxy',
    risk: 'network',
    summary: 'Change the download proxy'
  },
  downloadPath: {
    action: 'settings.download_path',
    risk: 'config',
    summary: 'Change the download folder'
  }
} as const satisfies Record<
  string,
  { action: ApprovalAction; risk: ApprovalRequest['risk']; summary: string }
>

const AI_DELETE_ACTIONS: Record<string, ApprovalAction> = {
  delete_provider: 'ai.delete_provider',
  delete_prompt: 'ai.delete_prompt'
}

const MAX_LINK_DEPTH = 32

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
  if (tool === 'update_settings') {
    return settingsApproval(record)
  }
  if (tool === 'manage_ai_settings') {
    return aiApproval(record)
  }
  if (tool === 'manage_asr_model') {
    return asrApproval(record)
  }
  if (tool === 'inspect_media_engine') {
    return engineApproval(record)
  }
  return null
}

/**
 * Ask before proxy, yt-dlp config, or download-folder changes. Other settings stay ungated.
 *
 * Proxy values are omitted from the summary so credentials never reach the approval card.
 *
 * @param record update_settings arguments.
 */
function settingsApproval(record: Record<string, unknown>): ApprovalRequest | null {
  const fields = (Object.keys(PROTECTED_SETTINGS) as (keyof typeof PROTECTED_SETTINGS)[]).filter(
    (key) => record[key] !== undefined
  )
  if (fields.length === 0) {
    return null
  }
  const primary = PROTECTED_SETTINGS[fields[0]]
  if (fields.length > 1) {
    return {
      action: 'settings.update',
      summary: `Change protected settings (${fields.join(', ')})`,
      risk: primary.risk
    }
  }
  const key = fields[0]
  const value = record[key]
  const quoted = key !== 'proxy' && typeof value === 'string' && value ? ` to “${value}”` : ''
  const warning = key === 'configPath' ? '. This file can run shell commands' : ''
  return {
    action: primary.action,
    summary: `${primary.summary}${quoted}${warning}`,
    risk: primary.risk
  }
}

/**
 * Ask before deleting a provider or prompt. Reads and other edits stay ungated.
 *
 * @param record manage_ai_settings arguments.
 */
function aiApproval(record: Record<string, unknown>): ApprovalRequest | null {
  const action = typeof record.action === 'string' ? AI_DELETE_ACTIONS[record.action] : undefined
  if (!action) {
    return null
  }
  const id = typeof record.id === 'string' && record.id ? record.id : 'this item'
  return { action, summary: `${labelAction(action)} ${id}`, risk: 'destructive' }
}

/**
 * Ask before deleting an installed transcription model.
 *
 * @param record manage_asr_model arguments.
 */
function asrApproval(record: Record<string, unknown>): ApprovalRequest | null {
  if (record.action !== 'delete') {
    return null
  }
  const tier = typeof record.tier === 'string' && record.tier ? record.tier : 'the selected tier'
  return {
    action: 'asr.delete',
    summary: `${labelAction('asr.delete')} ${tier}`,
    risk: 'destructive'
  }
}

/**
 * Ask before downloading and activating a yt-dlp release. Status and repair stay ungated.
 *
 * @param record inspect_media_engine arguments.
 */
function engineApproval(record: Record<string, unknown>): ApprovalRequest | null {
  if (record.action !== 'update_ytdlp') {
    return null
  }
  return {
    action: 'ytdlp.update',
    summary: 'Download and activate the stable yt-dlp release',
    risk: 'network'
  }
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
 * Absolute path with symlinks resolved. Missing tails stay on the realpath of the nearest existing parent.
 *
 * Native realpath applies ".." after symlink targets. Lexical path.resolve would hide those escapes.
 *
 * @param target Path from tool arguments or the configured library root.
 * @param depth Symlink follow count, bounded to avoid cycles.
 */
function canonicalPath(target: string, depth = 0): string {
  if (depth > MAX_LINK_DEPTH) {
    return path.resolve(target)
  }
  let current = path.isAbsolute(target) ? target : path.resolve(target)
  const missing: string[] = []
  while (true) {
    try {
      return path.resolve(realpathSync.native(current), ...missing)
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        return path.resolve(current, ...missing)
      }
      const linked = symlinkTarget(current)
      if (linked) {
        return path.resolve(canonicalPath(linked, depth + 1), ...missing)
      }
      const parent = path.dirname(current)
      if (parent === current) {
        return path.resolve(current, ...missing)
      }
      missing.unshift(path.basename(current))
      current = parent
    }
  }
}

/**
 * Absolute target of a symlink, including a broken link. Null when the path is not a link.
 *
 * @param candidate Path that realpath could not resolve.
 */
function symlinkTarget(candidate: string): string | null {
  try {
    if (!lstatSync(candidate).isSymbolicLink()) {
      return null
    }
    return path.resolve(path.dirname(candidate), readlinkSync(candidate))
  } catch {
    return null
  }
}

/**
 * Node error code when the thrown value carries one.
 *
 * @param error Thrown value from a filesystem call.
 */
function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return undefined
}

/**
 * True when a download directory sits outside the user's library root.
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
  const resolved = canonicalPath(downloadDirectory)
  const root = canonicalPath(downloadPath)
  return resolved !== root && !resolved.startsWith(`${root}${path.sep}`)
}

/**
 * Hard filesystem rule: an out-of-tree download directory always needs interactive approval.
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
  const record = params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
  const candidate =
    tool === 'manage_subscription'
      ? record.downloadDirectory
      : tool === 'update_settings'
        ? record.downloadPath
        : undefined
  return typeof candidate === 'string' && isOutsideDownloadPath(candidate, downloadPath)
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
    case 'settings.proxy':
      return 'Change proxy'
    case 'settings.config_path':
      return 'Change yt-dlp config'
    case 'settings.download_path':
      return 'Change download folder'
    case 'settings.update':
      return 'Change protected settings'
    case 'ai.delete_provider':
      return 'Delete AI provider'
    case 'ai.delete_prompt':
      return 'Delete prompt'
    case 'asr.delete':
      return 'Delete transcription model'
    case 'ytdlp.update':
      return 'Update yt-dlp'
    default:
      return action
  }
}
