import log from '../utils/logger'
import { stopAllAgentRuns } from './agent-chat-runner'
import { stopAllPromptRuns } from './ai-prompt-runner'
import { allowAppQuit } from './quit-confirmation-host'

let preparation: Promise<void> | null = null
let prepared = false

/** Check whether an approved quit has started, including update installation. */
export const isAppQuitting = (): boolean => preparation !== null

/** Check whether asynchronous shutdown work has finished. */
export const isAppQuitPrepared = (): boolean => prepared

/** Stop AI work once before either normal quit or the updater closes windows. */
export const prepareAppQuit = (): Promise<void> => {
  if (!preparation) {
    allowAppQuit()
    preparation = Promise.allSettled([stopAllPromptRuns(), stopAllAgentRuns()]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') {
          log.warn('Failed to stop AI work before quitting:', result.reason)
        }
      }
      prepared = true
    })
  }
  return preparation
}
