import { ipcServices } from '@renderer/lib/ipc'
import type { ShareCardPayload } from '@shared/types/share-card'

// biome-ignore lint/performance/noBarrelFile: Preserve existing imports while sharing native and browser export naming.
export { exportBaseFileName, exportFileName, shareImageFileName } from '@shared/agent-export'

/**
 * Wait for the next two animation frames so layout and paint can settle.
 */
const nextPaint = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })

/**
 * Wait until an image has finished loading or failed, then decode painted frames.
 *
 * @param image Image node inside the share card.
 */
const waitForImage = async (image: HTMLImageElement): Promise<void> => {
  if (!image.complete) {
    await new Promise<void>((resolve) => {
      const done = (): void => resolve()
      image.addEventListener('load', done, { once: true })
      image.addEventListener('error', done, { once: true })
    })
  }
  if (image.naturalWidth > 0) {
    await image.decode().catch(() => undefined)
  }
}

/**
 * Wait until every image inside the share card has settled.
 *
 * @param element Root of the share card.
 */
const waitForImages = async (element: HTMLElement): Promise<void> => {
  await Promise.all([...element.querySelectorAll('img')].map((image) => waitForImage(image)))
}

const FILL_READY_TIMEOUT_MS = 4000
const REMOTE_IMAGE_READY_TIMEOUT_MS = 15_000
const REMOTE_IMAGE_PENDING = '[data-remote-image="pending"]'

/**
 * Wait until a predicate is false, or time out.
 *
 * @param element Root to observe.
 * @param isPending True while the waiter should keep blocking.
 * @param options MutationObserver filters and timeout.
 */
const waitUntilSettled = async (
  element: HTMLElement,
  isPending: () => boolean,
  options: { attributeFilter: string[]; subtree?: boolean; timeoutMs: number }
): Promise<void> => {
  if (!isPending()) {
    return
  }
  await new Promise<void>((resolve) => {
    /**
     * Stop watching once the predicate clears or the timeout fires.
     */
    const finish = (): void => {
      observer.disconnect()
      window.clearTimeout(timer)
      resolve()
    }
    const observer = new MutationObserver(() => {
      if (!isPending()) {
        finish()
      }
    })
    const timer = window.setTimeout(finish, options.timeoutMs)
    observer.observe(element, {
      attributeFilter: options.attributeFilter,
      attributes: true,
      childList: options.subtree === true,
      subtree: options.subtree === true
    })
    if (!isPending()) {
      finish()
    }
  })
}

/**
 * Wait until RemoteImage nodes have resolved and painted, or time out.
 *
 * Cover thumbs go through cache resolution before an `img` exists, so waiting
 * only on current `img` tags snapshots the loading spinner.
 *
 * @param element Root of the share card.
 */
const waitForRemoteImages = async (element: HTMLElement): Promise<void> => {
  await waitUntilSettled(element, () => Boolean(element.querySelector(REMOTE_IMAGE_PENDING)), {
    attributeFilter: ['data-remote-image'],
    subtree: true,
    timeoutMs: REMOTE_IMAGE_READY_TIMEOUT_MS
  })
}

/**
 * Wait until a prompt card has finished sampling its cover fill, or time out.
 *
 * @param element Root of the share card.
 */
const waitForShareFill = async (element: HTMLElement): Promise<void> => {
  await waitUntilSettled(element, () => element.getAttribute('data-share-fill') === 'pending', {
    attributeFilter: ['data-share-fill'],
    timeoutMs: FILL_READY_TIMEOUT_MS
  })
}

/**
 * Wait until fonts, images, cover fill, and layout are painted for a snapshot.
 *
 * @param element Root of the share card.
 */
export const waitForShareCard = async (element: HTMLElement): Promise<void> => {
  await waitForRemoteImages(element)
  await waitForImages(element)
  await waitForShareFill(element)
  if (document.fonts?.ready) {
    await document.fonts.ready
  }
  await nextPaint()
}

/**
 * Render the share card in the hidden window and return a PNG blob.
 *
 * @param payload Serializable card props from the visible preview.
 */
export const captureShareImageBlob = async (payload: ShareCardPayload): Promise<Blob> => {
  const png = await ipcServices.window.captureShareCard(payload)
  return new Blob([png], { type: 'image/png' })
}

/**
 * Copy a PNG blob to the system clipboard through the main process.
 *
 * @param png PNG bytes from `captureShareImageBlob`.
 */
export const copyShareImageBlob = async (png: Blob): Promise<void> => {
  await ipcServices.window.writeShareImage(await png.arrayBuffer())
}
