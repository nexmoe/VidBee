import { join } from 'node:path'
import { APP_PROTOCOL_SCHEME } from '@shared/constants'
import {
  SHARE_CAPTURE_HASH,
  SHARE_CAPTURE_READY_CHANNEL,
  SHARE_CAPTURE_RENDER_CHANNEL,
  SHARE_CARD_WIDTH,
  type ShareCaptureReadyMessage,
  type ShareCaptureRenderMessage,
  type ShareCardPayload
} from '@shared/types/share-card'
import { BrowserWindow, clipboard, ipcMain, nativeImage } from 'electron'
import { scopedLoggers } from '../utils/logger'
import { splitShareImage } from './share-image-split'

const log = scopedLoggers.window
const INITIAL_HEIGHT = 800
const READY_TIMEOUT_MS = 20_000
const PAINT_SETTLE_SCRIPT =
  'new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())) })'
const DEVICE_PIXEL_RATIO_SCRIPT = 'window.devicePixelRatio'
/** IOSurface/GPU texture cap. Keep offscreen frames below it to avoid GPU crashes. */
export const SHARE_CAPTURE_MAX_TEXTURE_EDGE = 16_384
const SHARE_CAPTURE_TEXTURE_SAFETY = 256
const SHARE_CAPTURE_BYTES_PER_PIXEL = 4

export interface ShareCaptureImage {
  crop?: (rect: { x: number; y: number; width: number; height: number }) => ShareCaptureImage
  getSize?: () => { height: number; width: number }
  isEmpty: () => boolean
  toBitmap?: () => Buffer
  toPNG?: () => Buffer
}

type ShareCapturePaintListener = (event: unknown, dirty: unknown, image: ShareCaptureImage) => void

export interface ShareCaptureWindowLike {
  destroy: () => void
  isDestroyed: () => boolean
  loadURL: (url: string) => Promise<void>
  on: (event: 'closed', listener: () => void) => void
  setContentSize: (width: number, height: number) => void
  webContents: {
    executeJavaScript: (script: string) => Promise<unknown>
    invalidate: () => void
    isDestroyed: () => boolean
    on: (event: 'paint', listener: ShareCapturePaintListener) => void
    removeListener: (event: 'paint', listener: ShareCapturePaintListener) => void
    send: (channel: string, ...args: unknown[]) => void
    setBackgroundThrottling: (value: boolean) => void
  }
}

export interface ShareCaptureDeps {
  BrowserWindow: new (options: object) => ShareCaptureWindowLike
  clipboard: { writeImage: (image: ShareCaptureImage) => void }
  ipcMain: {
    on: (
      channel: string,
      listener: (
        event: { sender: ShareCaptureWindowLike['webContents'] },
        message: ShareCaptureReadyMessage
      ) => void
    ) => void
  }
  nativeImage: {
    createFromBitmap?: (
      buffer: Buffer,
      options: { height: number; width: number }
    ) => ShareCaptureImage
    createFromBuffer: (buffer: Buffer) => ShareCaptureImage
  }
}

/**
 * Largest CSS edge that still fits in a GPU texture at this device scale.
 *
 * @param scaleFactor Window `devicePixelRatio`, or 1 when unknown.
 */
export const shareCaptureMaxCssEdge = (scaleFactor: number): number => {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  return Math.max(
    1,
    Math.floor((SHARE_CAPTURE_MAX_TEXTURE_EDGE - SHARE_CAPTURE_TEXTURE_SAFETY) / scale)
  )
}

/**
 * Move the painted card so `offsetY` is at the top of the hidden window.
 *
 * @param offsetY CSS pixels already captured above the current strip.
 * @param frameColor Optional RGB marker used to reject stale compositor frames.
 */
export const shareCaptureOffsetScript = (offsetY: number, frameColor?: number): string => {
  const marker =
    frameColor === undefined
      ? ''
      : `var m=document.querySelector('[data-share-capture-marker]');if(!m){m=document.createElement('div');m.setAttribute('data-share-capture-marker','');document.body.appendChild(m);}m.style.cssText='position:fixed;top:0;right:0;width:1px;height:1px;z-index:2147483647;background:#${frameColor.toString(16).padStart(6, '0')}';`
  return `void (function(){var s=document.querySelector('[data-share-capture-stage]');if(s){s.style.position='relative';s.style.top='-${offsetY}px';}${marker}})()`
}

/** Wait for an actual compositor repaint after positioning the offscreen capture window. */
const waitForShareCapturePaint = (
  contents: ShareCaptureWindowLike['webContents'],
  width: number,
  height: number,
  frameColor: number
): Promise<ShareCaptureImage> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      contents.removeListener('paint', onPaint)
      reject(new Error('Share card repaint timed out'))
    }, READY_TIMEOUT_MS)
    /** Release the capture only after Electron has produced a fresh frame. */
    const onPaint: ShareCapturePaintListener = (_event, _dirty, image): void => {
      const size = image.getSize?.()
      if (size?.width !== width || size.height !== height) {
        contents.invalidate()
        return
      }
      const bitmap = image.toBitmap?.()
      const markerOffset = (width - 1) * SHARE_CAPTURE_BYTES_PER_PIXEL
      // NativeImage bitmaps use BGRA. The marker is outside the exported card.
      if (
        !bitmap ||
        bitmap.length < markerOffset + 3 ||
        bitmap.readUIntLE(markerOffset, 3) !== frameColor
      ) {
        contents.invalidate()
        return
      }
      clearTimeout(timer)
      contents.removeListener('paint', onPaint)
      resolve(image)
    }
    contents.on('paint', onPaint)
    contents.invalidate()
  })

/**
 * Stack captured bitmaps top-to-bottom into one PNG.
 *
 * @param strips Window snapshots in top-to-bottom order.
 * @param nativeImage Electron nativeImage (or test stand-in).
 */
export const stitchShareCaptureStrips = (
  strips: ShareCaptureImage[],
  nativeImage: ShareCaptureDeps['nativeImage']
): Buffer => {
  const first = strips[0]
  if (strips.length === 1) {
    const png = first?.toPNG?.()
    if (!png) {
      throw new Error('Share card capture is empty')
    }
    return png
  }
  if (!nativeImage.createFromBitmap) {
    throw new Error('Share card stitch requires nativeImage.createFromBitmap')
  }
  const sizes = strips.map((strip) => {
    const size = strip.getSize?.()
    const bitmap = strip.toBitmap?.()
    if (!(size && bitmap && size.width > 0 && size.height > 0)) {
      throw new Error('Share card capture strip is empty')
    }
    return { bitmap, height: size.height, width: size.width }
  })
  const width = sizes[0]?.width ?? 0
  const height = sizes.reduce((sum, size) => sum + size.height, 0)
  const packed = Buffer.alloc(width * height * SHARE_CAPTURE_BYTES_PER_PIXEL)
  let offset = 0
  for (const size of sizes) {
    if (size.width !== width) {
      throw new Error('Share card capture strips must share a width')
    }
    const bytes = size.width * size.height * SHARE_CAPTURE_BYTES_PER_PIXEL
    size.bitmap.copy(packed, offset, 0, bytes)
    offset += bytes
  }
  const image = nativeImage.createFromBitmap(packed, { height, width })
  if (image.isEmpty() || !image.toPNG) {
    throw new Error('Share card stitch is empty')
  }
  return image.toPNG()
}

/**
 * Build the hidden-window URL that mounts the share-capture page.
 */
export const shareCaptureUrl = (): string => {
  const base =
    (process.env.ELECTRON_RENDERER_URL &&
      (process.env.PORTLESS_URL || process.env.ELECTRON_RENDERER_URL)) ||
    `${APP_PROTOCOL_SCHEME}renderer/index.html`
  return `${base}#${SHARE_CAPTURE_HASH}`
}

/**
 * Create a reusable hidden-window share-card capturer.
 *
 * @param deps Electron (or test) collaborators.
 */
export const createShareCaptureHost = (deps: ShareCaptureDeps) => {
  let shareWindow: ShareCaptureWindowLike | null = null
  let loadPromise: Promise<void> | null = null
  let captureChain: Promise<unknown> = Promise.resolve()
  let nextRequestId = 1
  let nextFrameColor = 1
  let readyListenerBound = false
  const pendingReady = new Map<
    number,
    { reject: (error: Error) => void; resolve: (size: ShareCaptureReadyMessage) => void }
  >()

  /**
   * Listen for layout-ready messages from the hidden capture renderer.
   */
  const bindShareCaptureReadyListener = (): void => {
    if (readyListenerBound) {
      return
    }
    readyListenerBound = true
    deps.ipcMain.on(SHARE_CAPTURE_READY_CHANNEL, (event, message) => {
      if (shareWindow?.webContents !== event.sender) {
        return
      }
      const pending = pendingReady.get(message.requestId)
      if (!pending) {
        return
      }
      pendingReady.delete(message.requestId)
      pending.resolve(message)
    })
  }

  /**
   * True when `window` is the reused hidden share-capture window.
   *
   * @param window Candidate window.
   */
  const isShareCaptureWindow = (window: ShareCaptureWindowLike): boolean =>
    shareWindow !== null && window === shareWindow

  /**
   * True when `window` is a real app window the user can interact with.
   *
   * @param window Candidate window.
   */
  const isAppWindow = (window: ShareCaptureWindowLike): boolean =>
    !(window.isDestroyed() || isShareCaptureWindow(window))

  /**
   * Destroy the hidden share-capture window if it exists.
   */
  const destroyShareCaptureWindow = (): void => {
    for (const [requestId, pending] of pendingReady) {
      pendingReady.delete(requestId)
      pending.reject(new Error('Share capture window was closed'))
    }
    loadPromise = null
    if (!shareWindow || shareWindow.isDestroyed()) {
      shareWindow = null
      return
    }
    shareWindow.destroy()
    shareWindow = null
  }

  /**
   * Write PNG bytes to the system clipboard as an image.
   *
   * @param png PNG bytes from `captureShareCardPng`.
   */
  const writeShareImagePng = (png: ArrayBuffer | Buffer | Uint8Array): void => {
    const image = deps.nativeImage.createFromBuffer(
      Buffer.from(png instanceof ArrayBuffer ? new Uint8Array(png) : png)
    )
    if (image.isEmpty()) {
      throw new Error('Share image is empty')
    }
    deps.clipboard.writeImage(image)
  }

  /**
   * Wait until the hidden renderer reports a stable card box.
   *
   * @param requestId Capture request id sent with the payload.
   */
  const waitForShareCardReady = (requestId: number): Promise<ShareCaptureReadyMessage> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingReady.delete(requestId)
        reject(new Error('Share card layout timed out'))
      }, READY_TIMEOUT_MS)
      pendingReady.set(requestId, {
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
        resolve: (message) => {
          clearTimeout(timer)
          resolve(message)
        }
      })
    })

  /**
   * Load the capture page once and reuse the same hidden window.
   */
  const ensureShareCaptureWindow = async (): Promise<ShareCaptureWindowLike> => {
    bindShareCaptureReadyListener()
    if (shareWindow && !shareWindow.isDestroyed() && !shareWindow.webContents.isDestroyed()) {
      if (loadPromise) {
        await loadPromise
      }
      return shareWindow
    }
    destroyShareCaptureWindow()
    const window = new deps.BrowserWindow({
      width: SHARE_CARD_WIDTH,
      height: INITIAL_HEIGHT,
      show: false,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      autoHideMenuBar: true,
      enableLargerThanScreen: true,
      hiddenInMissionControl: true,
      backgroundColor: '#d09468',
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: true,
        backgroundThrottling: false
      }
    })
    window.webContents.setBackgroundThrottling(false)
    window.on('closed', () => {
      if (shareWindow === window) {
        shareWindow = null
        loadPromise = null
      }
    })
    shareWindow = window
    loadPromise = window
      .loadURL(shareCaptureUrl())
      .then(() => undefined)
      .catch((error: unknown) => {
        log.warn(
          `Failed to load share capture window: ${error instanceof Error ? error.message : String(error)}`
        )
        if (shareWindow === window) {
          destroyShareCaptureWindow()
        }
        throw error
      })
    await loadPromise
    return window
  }

  /**
   * Paint one payload, then snapshot it in GPU-safe strips if the card is very tall.
   *
   * @param payload Serializable card props.
   */
  const captureShareCardPngOnce = async (
    payload: ShareCardPayload
  ): Promise<{ png: Buffer; layout: ShareCaptureReadyMessage['layout'] }> => {
    const window = await ensureShareCaptureWindow()
    const requestId = nextRequestId
    nextRequestId += 1
    const ready = waitForShareCardReady(requestId)
    const message: ShareCaptureRenderMessage = { payload, requestId }
    window.webContents.send(SHARE_CAPTURE_RENDER_CHANNEL, message)
    const size = await ready
    if (!(size.width > 0 && size.height > 0)) {
      throw new Error('Share card capture rect is empty')
    }
    const width = Math.ceil(size.width)
    const height = Math.ceil(size.height)
    const scaleValue = await window.webContents.executeJavaScript(DEVICE_PIXEL_RATIO_SCRIPT)
    const scaleFactor = typeof scaleValue === 'number' && scaleValue > 0 ? scaleValue : 1
    const maxCssEdge = shareCaptureMaxCssEdge(scaleFactor)
    const strips: ShareCaptureImage[] = []
    // Keep the compositor viewport stable; crop the last strip instead of resizing it.
    window.setContentSize(width + 1, Math.min(maxCssEdge, height))
    try {
      await window.webContents.executeJavaScript(PAINT_SETTLE_SCRIPT)
      for (let offsetY = 0; offsetY < height; ) {
        const stripHeight = Math.min(maxCssEdge, height - offsetY)
        const frameColor = nextFrameColor
        nextFrameColor = (nextFrameColor % 0xff_ff_ff) + 1
        await window.webContents.executeJavaScript(shareCaptureOffsetScript(offsetY, frameColor))
        await window.webContents.executeJavaScript(PAINT_SETTLE_SCRIPT)
        const frame = await waitForShareCapturePaint(
          window.webContents,
          Math.round((width + 1) * scaleFactor),
          Math.round(Math.min(maxCssEdge, height) * scaleFactor),
          frameColor
        )
        if (frame.isEmpty() || !frame.crop) {
          throw new Error('Share card paint is empty')
        }
        const image = frame.crop({
          x: 0,
          y: 0,
          width: Math.round(width * scaleFactor),
          height: Math.round(stripHeight * scaleFactor)
        })
        if (image.isEmpty()) {
          throw new Error('Share card capture is empty')
        }
        strips.push(image)
        offsetY += stripHeight
      }
    } finally {
      await window.webContents.executeJavaScript(shareCaptureOffsetScript(0))
    }
    return { png: stitchShareCaptureStrips(strips, deps.nativeImage), layout: size.layout }
  }

  /**
   * Capture the share card in a reused hidden window. Serialized across callers.
   *
   * @param payload Serializable card props from the visible preview.
   */
  const captureShareCard = async (payload: ShareCardPayload) => {
    const run = captureChain.then(
      () => captureShareCardPngOnce(payload),
      () => captureShareCardPngOnce(payload)
    )
    captureChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /** Capture a full poster without changing its original layout. */
  const captureShareCardPng = async (payload: ShareCardPayload): Promise<Buffer> =>
    (await captureShareCard(payload)).png

  /** Capture and paginate the same rendered layout so page breaks cannot go stale. */
  const captureShareCardPages = async (
    payload: ShareCardPayload,
    imageCount?: number
  ): Promise<Buffer[]> => {
    const { png, layout } = await captureShareCard(payload)
    if (!layout) {
      throw new Error('Share card pagination layout is missing')
    }
    return splitShareImage(png, layout, imageCount)
  }

  return {
    captureShareCardPages,
    captureShareCardPng,
    destroyShareCaptureWindow,
    isAppWindow,
    isShareCaptureWindow,
    writeShareImagePng
  }
}

const defaultHost = createShareCaptureHost({
  BrowserWindow,
  clipboard: {
    writeImage: (image) => {
      if (!image.toPNG) {
        throw new Error('Share capture image cannot be encoded as PNG')
      }
      clipboard.writeImage(nativeImage.createFromBuffer(image.toPNG()))
    }
  },
  ipcMain,
  nativeImage
})

export const captureShareCardPng = defaultHost.captureShareCardPng
export const captureShareCardPages = defaultHost.captureShareCardPages
export const destroyShareCaptureWindow = defaultHost.destroyShareCaptureWindow
export const isAppWindow = defaultHost.isAppWindow as (window: BrowserWindow) => boolean
export const isShareCaptureWindow = defaultHost.isShareCaptureWindow as (
  window: BrowserWindow
) => boolean
export const writeShareImagePng = defaultHost.writeShareImagePng
