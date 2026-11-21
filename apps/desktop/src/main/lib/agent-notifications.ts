import { type TranslationDictionary, translationResources } from '@vidbee/i18n'
import { normalizeLanguageCode } from '@vidbee/i18n/languages'
import { BrowserWindow, Notification } from 'electron'
import type { AgentChatRun, AgentThread } from '../../shared/agent-chat'
import {
  AGENT_NOTIFICATION_OPEN_CHANNEL,
  type AgentNotificationTarget
} from '../../shared/agent-notifications'
import { agentUiNeedsResponse } from '../../shared/agent-ui'
import { settingsManager } from '../settings'
import { scopedLoggers } from '../utils/logger'

const notifications = new Map<string, Map<string, Notification>>()
let pendingTarget: AgentNotificationTarget | null = null

/** Deliver a click once the renderer is listening, including after its window was recreated. */
export function takeAgentNotificationTarget(): AgentNotificationTarget | null {
  const target = pendingTarget
  pendingTarget = null
  return target
}

/** Restore the application and open the conversation without approving any operation. */
async function openNotificationThread(target: AgentNotificationTarget): Promise<void> {
  try {
    pendingTarget = target
    const [{ showAndFocusWindow }, { isAppWindow }] = await Promise.all([
      import('./app-icon-menu'),
      import('./share-capture-window')
    ])
    let window = BrowserWindow.getAllWindows().find(isAppWindow)
    if (!window) {
      const { createWindow } = await import('../index')
      createWindow()
      window = BrowserWindow.getAllWindows().find(isAppWindow)
    }
    if (!window || window.webContents.isDestroyed() || window.webContents.isCrashed()) {
      return
    }
    showAndFocusWindow(window)
    window.webContents.send(AGENT_NOTIFICATION_OPEN_CHANNEL)
  } catch (error) {
    scopedLoggers.ai.warn(`Agent notification navigation failed: ${String(error)}`)
  }
}

/** Close obsolete requests when a conversation is deleted or starts another turn. */
export function clearAgentNotifications(threadId: string): void {
  if (pendingTarget?.threadId === threadId) {
    pendingTarget = null
  }
  const current = notifications.get(threadId)
  notifications.delete(threadId)
  for (const notification of current?.values() ?? []) {
    notification.close()
  }
}

/** Publish only durable requests for user input; notification failures never fail a run. */
export function syncAgentNotifications(thread: AgentThread, run: AgentChatRun): void {
  try {
    const pending = new Map<string, 'approval' | 'response'>()
    if (run.status === 'running') {
      for (const tool of run.tools) {
        if (tool.status === 'pending-approval') {
          pending.set(`${run.id}:${tool.id}`, 'approval')
        }
      }
    } else if (
      run.status === 'completed' &&
      run.tools.some(
        (tool) => tool.status === 'completed' && tool.ui && agentUiNeedsResponse(tool.ui)
      )
    ) {
      pending.set(run.id, 'response')
    }
    const current = notifications.get(thread.id) ?? new Map<string, Notification>()
    for (const [key, notification] of current) {
      if (!pending.has(key)) {
        current.delete(key)
        notification.close()
      }
    }
    if (pending.size === 0) {
      notifications.delete(thread.id)
      return
    }
    if (!Notification.isSupported()) {
      return
    }
    notifications.set(thread.id, current)
    const language = normalizeLanguageCode(settingsManager.get('language'))
    const translation = (translationResources[language] ?? translationResources.en)
      .translation as TranslationDictionary
    const copy = translation.agentChat.notifications
    for (const [key, kind] of pending) {
      if (current.has(key)) {
        continue
      }
      const notification = new Notification({
        title: copy[kind],
        body: copy.body,
        silent: false
      })
      notification.on('click', () => {
        void openNotificationThread({
          threadId: thread.id,
          downloadId: thread.downloadId,
          promptId: thread.promptId
        })
      })
      notification.on('failed', (_event, error) => {
        scopedLoggers.ai.warn(`Agent notification failed: ${error}`)
      })
      current.set(key, notification)
      notification.show()
    }
  } catch (error) {
    scopedLoggers.ai.warn(`Agent notification failed: ${String(error)}`)
  }
}
