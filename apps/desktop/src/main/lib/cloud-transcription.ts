import { join } from 'node:path'
import type { TranscriptionExecutorOptions } from '@vidbee/transcription'
import type {
  CloudTranscriptionCatalog,
  CloudTranscriptionResult
} from '@vidbee/transcription/cloud'
import { runCloudTranscription } from '@vidbee/transcription/cloud-runner'
import { app, BrowserWindow } from 'electron'
import { ffmpegManager } from './ffmpeg-manager'

/** Validate an authenticated speech catalog before it controls prices and model selection in Settings. */
export async function loadCloudTranscriptionModels(): Promise<CloudTranscriptionCatalog> {
  const { authClient, getDesktopAuthApiUrl } = await import('./auth-client')
  const response = await fetch(`${getDesktopAuthApiUrl()}/api/ai/transcription/capabilities`, {
    headers: { Cookie: authClient.getCookie() },
    signal: AbortSignal.timeout(10_000)
  })
  if (response.status === 401) {
    throw new Error('Sign in to use Cloud transcription')
  }
  if (!response.ok) {
    throw new Error('Cloud transcription models are unavailable')
  }
  const catalog = (await response.json()) as CloudTranscriptionCatalog
  if (
    !(Array.isArray(catalog.models) && catalog.models.length) ||
    catalog.models.length > 50 ||
    !catalog.models.some((model) => model.id === catalog.defaultModelId) ||
    catalog.models.some(
      (model) =>
        typeof model.id !== 'string' ||
        typeof model.name !== 'string' ||
        !Number.isSafeInteger(model.creditsPerSecond) ||
        model.creditsPerSecond <= 0
    )
  ) {
    throw new Error('Invalid Cloud transcription catalog')
  }
  return catalog
}

/** Publish billing changes to account views without revealing cookies or provider credentials. */
function refreshCloudCredits(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('account:credits-updated')
    }
  }
}

/** Run a queued Cloud transcription with the signed-in account and isolated task checkpoints. */
export const runDesktopCloudTranscription: NonNullable<
  TranscriptionExecutorOptions['runCloud']
> = async (input) => {
  const { authClient, getDesktopAuthApiUrl } = await import('./auth-client')
  const session = await authClient.getSession()
  if (!session.data?.user) {
    throw new Error('Sign in to use Cloud transcription')
  }
  const cookie = authClient.getCookie()
  const baseUrl = getDesktopAuthApiUrl()
  try {
    return await runCloudTranscription({
      ...input,
      accountId: session.data.user.id,
      ffmpegPath: await ffmpegManager.ensureInitialized(),
      workRoot: join(app.getPath('userData'), 'transcript-work'),
      /** Keep the same request identity across ambiguous failures so Cloud can replay its result. */
      transcribe: async (audio, requestId, signal) => {
        /** Explicitly revoke the server hold when the local task is cancelled. */
        const cancel = (): void => {
          void fetch(`${baseUrl}/api/ai/prompt/cancel`, {
            method: 'POST',
            headers: { Cookie: cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId }),
            signal: AbortSignal.timeout(10_000)
          }).catch(() => {
            /* Lease recovery releases the hold if cancellation cannot reach Cloud. */
          })
        }
        signal.throwIfAborted()
        signal.addEventListener('abort', cancel, { once: true })
        try {
          const parameters = new URLSearchParams({ requestId, modelId: input.modelId })
          const response = await fetch(`${baseUrl}/api/ai/transcription?${parameters}`, {
            method: 'POST',
            headers: { Cookie: cookie, 'Content-Type': 'audio/wav' },
            body: audio as Uint8Array<ArrayBuffer>,
            signal: AbortSignal.any([signal, AbortSignal.timeout(105_000)])
          })
          const body = (await response.json()) as CloudTranscriptionResult & {
            code?: string
            error?: string
          }
          if (!response.ok) {
            throw Object.assign(new Error(body.error ?? 'Cloud transcription failed'), {
              code: body.code,
              status: response.status,
              retryAfterMs: Number(response.headers.get('Retry-After')) * 1000
            })
          }
          if (
            body.requestId !== requestId ||
            body.modelId !== input.modelId ||
            typeof body.text !== 'string' ||
            !Number.isSafeInteger(body.credits) ||
            body.credits < 0
          ) {
            throw new Error('Invalid Cloud transcription response')
          }
          refreshCloudCredits()
          return body
        } finally {
          signal.removeEventListener('abort', cancel)
        }
      }
    })
  } finally {
    refreshCloudCredits()
  }
}
