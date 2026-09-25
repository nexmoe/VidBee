import { FILENAME_STYLES } from '@vidbee/downloader-core/filename-style'
import { MAX_SUBTITLE_LANGUAGES } from '@vidbee/downloader-core/subtitle-languages'
import { languages } from '@vidbee/i18n/languages'
import { ASR_TIER_IDS } from '@vidbee/transcription/asr'
import { z } from 'zod'
import { AGENT_THINKING_LEVELS } from './agent-chat'
import type { AppSettings } from './types'

const text = z.string().max(4096)

/** Explicit public setting fields; internal migration markers and enforced updates are excluded. */
export const agentSettingsSchema = z
  .object({
    downloadPath: text.min(1),
    maxConcurrentDownloads: z.number().int().min(1).max(10),
    downloadWithoutChannelSubfolders: z.boolean(),
    browserForCookies: text,
    cookiesPath: text,
    proxy: text,
    configPath: text,
    language: z.enum(
      Object.keys(languages) as [AppSettings['language'], ...AppSettings['language'][]]
    ),
    theme: z.enum(['system', 'light', 'dark']),
    oneClickDownload: z.boolean(),
    oneClickDownloadType: z.enum(['video', 'audio']),
    oneClickQuality: z.enum(['best', 'good', 'normal', 'bad', 'worst']),
    oneClickContainer: z.enum(['auto', 'mp4', 'mkv', 'webm', 'original']),
    closeToTray: z.boolean(),
    hideDockIcon: z.boolean(),
    launchAtLogin: z.boolean(),
    subscriptionOnlyLatestDefault: z.boolean(),
    enableAnalytics: z.boolean(),
    enableDownloadNotifications: z.boolean(),
    rememberLastAudioLanguage: z.boolean(),
    preferredAudioLanguage: text,
    downloadSubtitles: z.boolean(),
    subtitleLanguages: z.array(z.string().min(1).max(100)).min(1).max(MAX_SUBTITLE_LANGUAGES),
    embedSubs: z.boolean(),
    writeAutoSubs: z.boolean(),
    embedThumbnail: z.boolean(),
    embedMetadata: z.boolean(),
    embedChapters: z.boolean(),
    filenameStyle: z.enum(FILENAME_STYLES),
    filenameViaVidBee: z.boolean(),
    shareWatermark: z.boolean(),
    autoTranscribeAfterDownload: z.boolean(),
    maxConcurrentTranscriptions: z.number().int().min(1).max(4),
    asrTier: z.enum(ASR_TIER_IDS),
    downloadMirror: z.enum(['auto', 'cn', 'global'])
  } satisfies Record<
    Exclude<
      keyof AppSettings,
      'autoUpdate' | 'lastSeenWhatsNew' | 'agentManagementTools' | 'agentMaxConcurrentRuns'
    >,
    z.ZodType
  >)
  .partial()
  .strict()

/** AI writes reuse existing secrets and expose only model and prompt configuration. */
export const agentAiSettingsSchema = z
  .object({
    action: z.enum([
      'list',
      'catalog',
      'select_cloud_model',
      'select_provider',
      'save_provider',
      'update_provider',
      'test_provider',
      'delete_provider',
      'save_prompt',
      'delete_prompt',
      'restore_prompts'
    ]),
    id: z.string().min(1).max(200).nullable().optional(),
    presetId: z.string().min(1).max(100).optional(),
    copyApiKeyFromId: z.string().min(1).max(200).optional(),
    baseUrl: z.string().max(4096).optional(),
    modelId: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(200).optional(),
    contextWindow: z.number().int().min(4096).max(2_000_000).optional(),
    maxTokens: z.number().int().min(1).max(2_000_000).optional(),
    vision: z.boolean().optional(),
    tools: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    thinkingOnly: z.boolean().optional(),
    allowDisableThinking: z.boolean().optional(),
    thinkingLevels: z
      .array(z.enum(AGENT_THINKING_LEVELS))
      .max(AGENT_THINKING_LEVELS.length)
      .optional(),
    defaultThinkingLevel: z.enum(['auto', ...AGENT_THINKING_LEVELS]).optional(),
    title: z.string().min(1).max(200).optional(),
    content: z.string().min(1).max(50_000).optional(),
    enabled: z.boolean().optional()
  })
  .strict()
