import { app } from 'electron'
import { z } from 'zod'
import { agentAiSettingsSchema, agentSettingsSchema } from '../../shared/agent-settings'
import { getAgentSettings, manageAgentAi, updateAgentSettings } from '../lib/agent-capability-host'
import { getExtensionCookieConnection } from '../lib/extension-cookies'
import { getDesktopTaskQueue } from '../lib/task-queue-host'
import { getYtDlpKernelService } from '../lib/ytdlp-kernel-host'
import { defineMcpTool } from './tool'

/** Publish app health and validated public settings while keeping saved credentials private. */
export function createMcpSettingsTools() {
  return [
    defineMcpTool(
      'get_app_status',
      'Read Desktop version/platform, downloader readiness, extension connection and queue status.',
      z.object({}),
      () => ({
        version: app.getVersion(),
        platform: process.platform,
        ytDlp: getYtDlpKernelService().getStatus(),
        extension: getExtensionCookieConnection(),
        queue: getDesktopTaskQueue().stats()
      }),
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'get_settings',
      'Read public Desktop preferences. API keys, cookie contents and proxy credentials are never returned.',
      z.object({}),
      getAgentSettings,
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'update_settings',
      'Patch declared Desktop preferences, including download/subtitle defaults, language/theme, concurrency and ASR tier. Unspecified fields are preserved. Paths must be absolute; the ASR tier must be installed.',
      agentSettingsSchema,
      (input) => updateAgentSettings(input, { approvedPath: true }),
      { idempotentHint: true }
    ),
    defineMcpTool(
      'get_ai_settings',
      'Read configured AI providers and saved prompts without API keys or embedded endpoint credentials.',
      z.object({}),
      () => manageAgentAi({ action: 'list' }),
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'manage_ai_settings',
      'Manage provider models/capabilities, select or test saved providers, inspect/select Cloud models, and save/delete/restore prompts. Reuse saved keys through copyApiKeyFromId; configure new secrets inside Desktop Settings.',
      agentAiSettingsSchema,
      (input) => manageAgentAi(input),
      { destructiveHint: true, openWorldHint: true }
    )
  ]
}
