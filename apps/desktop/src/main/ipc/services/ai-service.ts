import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { AgentChatInput, AgentThread, AgentThreadSummary } from '../../../shared/agent-chat'
import {
  agentConversationTitle,
  agentThreadIsRunning,
  agentThreadUpdatedAt
} from '../../../shared/agent-history'
import { AI_PROVIDER_PRESETS } from '../../../shared/ai-presets'
import type {
  AiPrompt,
  AiPromptRunInput,
  AiPromptRunSnapshot,
  AiPromptWriteInput,
  AiProviderPreset,
  AiProviderPresetId,
  AiProviderTestResult,
  AiProviderWriteInput,
  AiSettingsSnapshot
} from '../../../shared/ai-types'
import { saveAgentArtifact } from '../../lib/agent-artifacts'
import {
  getAgentThinkingOptions,
  openAgentThread,
  removeAgentImage,
  deleteAgentThread as removeAgentThread,
  selectAgentBranch,
  selectAgentImages,
  sendAgentMessage,
  createAgentThread as startBlankAgentThread,
  stopAgentRun
} from '../../lib/agent-chat-runner'
import { getAgentChatStore } from '../../lib/agent-chat-store'
import {
  type CatalogModelCapabilities,
  type CatalogModelOption,
  listCatalogModelOptions,
  lookupCatalogModelCapabilities
} from '../../lib/ai-model'
import { getPromptRunSnapshot, startPromptRun, stopPromptRun } from '../../lib/ai-prompt-runner'
import { testProviderConnection } from '../../lib/ai-provider-test'
import { type AiRemoteModelsInput, listRemoteProviderModels } from '../../lib/ai-remote-models'
import { aiStore } from '../../lib/ai-store'
import { dislikeCloudResult } from '../../lib/cloud-device'
import { peekDesktopTaskQueueRef } from '../../lib/queue-ref'
import { settingsManager } from '../../settings'

/** Public history row that omits messages, runs and artifact paths. */
function toHistorySummary(thread: AgentThread): AgentThreadSummary {
  const videoTitle = peekDesktopTaskQueueRef()?.get(thread.downloadId)?.input.title?.trim() ?? ''
  return {
    id: thread.id,
    downloadId: thread.downloadId,
    promptId: thread.promptId,
    title: agentConversationTitle(thread, videoTitle),
    updatedAt: agentThreadUpdatedAt(thread),
    running: agentThreadIsRunning(thread)
  }
}

/** Conversations with messages, newest first. */
function listHistorySummaries(): AgentThreadSummary[] {
  return getAgentChatStore()
    .listHistory()
    .map(toHistorySummary)
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

class AiService extends IpcService {
  static readonly groupName = 'ai'

  /** Load supported thinking levels without exposing provider credentials. */
  @IpcMethod()
  async getAgentThinkingOptions() {
    return await getAgentThinkingOptions()
  }

  /** Load the persistent conversation for one video and agent. */
  @IpcMethod()
  getAgentThread(
    _context: IpcContext,
    input: { downloadId: string; promptId: string; threadId?: string }
  ): AgentThread {
    return openAgentThread(input.downloadId, input.promptId, input.threadId)
  }

  /** Start a blank Agent conversation on this video. */
  @IpcMethod()
  createAgentThread(_context: IpcContext, input: { downloadId: string }): AgentThread {
    return startBlankAgentThread(input.downloadId)
  }

  /** Submit a follow-up or regenerate one reply without overwriting its branch. */
  @IpcMethod()
  sendAgentMessage(_context: IpcContext, input: AgentChatInput): AgentThread {
    return sendAgentMessage(input)
  }

  /** Copy explicitly selected images into the conversation before admitting a message. */
  @IpcMethod()
  async selectAgentImages(_context: IpcContext, threadId: string): Promise<AgentThread> {
    return await selectAgentImages(threadId)
  }

  /** Remove only an attachment that has not been sent in a user message. */
  @IpcMethod()
  async removeAgentImage(
    _context: IpcContext,
    input: { threadId: string; imageId: string }
  ): Promise<AgentThread> {
    return await removeAgentImage(input.threadId, input.imageId)
  }

  /** Cancel only the selected conversation's model and media work. */
  @IpcMethod()
  async stopAgentRun(_context: IpcContext, threadId: string): Promise<AgentThread | null> {
    return await stopAgentRun(threadId)
  }

  /** Restore the conversation below the selected reply version. */
  @IpcMethod()
  selectAgentBranch(
    _context: IpcContext,
    input: { threadId: string; messageId: string }
  ): AgentThread {
    return selectAgentBranch(input.threadId, input.messageId)
  }

  /** Recover missed events and the current committed snapshot. */
  @IpcMethod()
  getAgentEvents(_context: IpcContext, input: { threadId: string; after: number }) {
    if (!Number.isSafeInteger(input.after) || input.after < 0) {
      throw new Error('Invalid event cursor')
    }
    return getAgentChatStore().events(input.threadId, input.after)
  }

  /** List conversations with messages or selected image drafts. */
  @IpcMethod()
  listAgentHistory(_context: IpcContext): AgentThreadSummary[] {
    return listHistorySummaries()
  }

  /** List every conversation on one video, including unused blank chats. */
  @IpcMethod()
  listAgentThreads(_context: IpcContext, input: { downloadId: string }): AgentThreadSummary[] {
    return getAgentChatStore().listVideoThreads(input.downloadId).map(toHistorySummary)
  }

  /** Rename a conversation tab without changing its messages. */
  @IpcMethod()
  renameAgentThread(
    _context: IpcContext,
    input: { threadId: string; title: string }
  ): AgentThreadSummary[] {
    getAgentChatStore().rename(input.threadId, input.title)
    return listHistorySummaries()
  }

  /** Delete one conversation without removing its source video. */
  @IpcMethod()
  async deleteAgentThread(_context: IpcContext, threadId: string): Promise<AgentThreadSummary[]> {
    await removeAgentThread(threadId)
    return listHistorySummaries()
  }

  /** Export a selected attachment without accepting filesystem paths from the renderer. */
  @IpcMethod()
  async saveAgentArtifact(
    _context: IpcContext,
    input: { threadId: string; artifactId: string }
  ): Promise<boolean> {
    return await saveAgentArtifact(input.threadId, input.artifactId)
  }

  /**
   * Return configured providers, the active provider, and prompts. API keys are omitted.
   */
  @IpcMethod()
  getSnapshot(_context: IpcContext): AiSettingsSnapshot {
    return aiStore.getSnapshot()
  }

  /**
   * Return the built-in provider catalog for the settings grid.
   */
  @IpcMethod()
  listPresets(_context: IpcContext): AiProviderPreset[] {
    return [...AI_PROVIDER_PRESETS]
  }

  /**
   * Fill the provider dialog from the pi-ai catalog, or null when the model id is unknown.
   *
   * @param input Provider preset and model id from the dialog.
   */
  @IpcMethod()
  lookupCatalogModel(
    _context: IpcContext,
    input: { presetId: AiProviderPresetId; modelId: string }
  ): CatalogModelCapabilities | null {
    return lookupCatalogModelCapabilities(input)
  }

  /**
   * List catalog models the provider dialog can pick or create from.
   *
   * @param presetId Built-in provider id from the dialog.
   */
  @IpcMethod()
  listCatalogModels(_context: IpcContext, presetId: AiProviderPresetId): CatalogModelOption[] {
    return listCatalogModelOptions(presetId)
  }

  /**
   * List models the typed (or saved) key can see on the provider host.
   *
   * @param input Dialog credentials, including an optional saved provider id.
   */
  @IpcMethod()
  async listRemoteModels(
    _context: IpcContext,
    input: AiRemoteModelsInput
  ): Promise<CatalogModelOption[]> {
    return await listRemoteProviderModels(input)
  }

  /**
   * Create or update a provider from the shared dialog.
   *
   * @param input Dialog values, including an optional API key.
   */
  @IpcMethod()
  upsertProvider(_context: IpcContext, input: AiProviderWriteInput): AiSettingsSnapshot {
    aiStore.upsertProvider(input)
    return aiStore.getSnapshot()
  }

  /**
   * Delete a configured provider.
   *
   * @param id Provider id.
   */
  @IpcMethod()
  deleteProvider(_context: IpcContext, id: string): AiSettingsSnapshot {
    return aiStore.deleteProvider(id)
  }

  /**
   * Enable the provider used for transcript prompts.
   *
   * @param id Provider id, or null to clear.
   */
  @IpcMethod()
  setActiveProvider(_context: IpcContext, id: string | null): AiSettingsSnapshot {
    return aiStore.setActiveProvider(id)
  }

  /**
   * Create or update a prompt.
   *
   * @param input Dialog values.
   */
  @IpcMethod()
  upsertPrompt(_context: IpcContext, input: AiPromptWriteInput): AiPrompt {
    return aiStore.upsertPrompt(input)
  }

  /**
   * Delete a prompt.
   *
   * @param id Prompt id.
   */
  @IpcMethod()
  deletePrompt(_context: IpcContext, id: string): AiSettingsSnapshot {
    return aiStore.deletePrompt(id)
  }

  /**
   * Re-insert any missing built-in prompts.
   */
  @IpcMethod()
  restoreDefaultPrompts(_context: IpcContext): AiSettingsSnapshot {
    return aiStore.restoreDefaultPrompts()
  }

  /**
   * Start a prompt run in the main process. Returns immediately; tokens arrive on `ai:prompt-run`.
   *
   * @param input Transcript text plus ids.
   */
  /** Record feedback for a result actually delivered by Cloud. */
  @IpcMethod()
  async dislikePrompt(_context: IpcContext, resultId: string): Promise<void> {
    await dislikeCloudResult(resultId)
  }

  @IpcMethod()
  startPrompt(_context: IpcContext, input: AiPromptRunInput): AiPromptRunSnapshot {
    return startPromptRun({
      ...input,
      uiLanguage: input.uiLanguage || String(settingsManager.get('language') ?? 'en')
    })
  }

  /**
   * Abort an in-flight prompt. Leaving the transcript page does not abort it.
   *
   * @param input Download and prompt ids.
   */
  @IpcMethod()
  stopPrompt(
    _context: IpcContext,
    input: { downloadId: string; promptId: string }
  ): AiPromptRunSnapshot {
    return stopPromptRun(input.downloadId, input.promptId)
  }

  /**
   * Restore a run after the renderer remounts.
   *
   * @param input Download and prompt ids.
   */
  @IpcMethod()
  getPromptRun(
    _context: IpcContext,
    input: { downloadId: string; promptId: string }
  ): AiPromptRunSnapshot {
    return getPromptRunSnapshot(input.downloadId, input.promptId)
  }

  /**
   * Send a short ping with the dialog values so the user can check the model.
   *
   * @param input Dialog values, including an optional API key.
   */
  @IpcMethod()
  async testProvider(
    _context: IpcContext,
    input: AiProviderWriteInput
  ): Promise<AiProviderTestResult> {
    return testProviderConnection(input)
  }
}

export { AiService }
