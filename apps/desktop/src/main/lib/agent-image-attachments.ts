import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ImageContent } from '@earendil-works/pi-ai'
import { BrowserWindow, dialog, nativeImage } from 'electron'
import {
  AGENT_MAX_MESSAGE_IMAGES,
  type AgentImageAttachment,
  type AgentThread
} from '../../shared/agent-chat'
import { resolveAgentArtifact } from './agent-artifacts'
import { agentMediaDirectory } from './agent-media'

const MAX_SOURCE_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_EDGE = 2048
// Cloud accepts a base64 image URL of at most 2.8 MB.
const MAX_IMAGE_BYTES = 2_000_000
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']

/** Decode and normalize selected image files before they can enter model requests. */
export async function importAgentImageFiles(
  threadId: string,
  files: string[]
): Promise<AgentImageAttachment[]> {
  if (!files.length || files.length > AGENT_MAX_MESSAGE_IMAGES) {
    throw new Error('Invalid image selection')
  }
  const images: AgentImageAttachment[] = []
  try {
    for (const file of files) {
      const info = await stat(file)
      if (!(info.isFile() && info.size) || info.size > MAX_SOURCE_BYTES) {
        throw new Error('Image must be no larger than 20 MB')
      }
      let image = nativeImage.createFromBuffer(await readFile(file))
      if (image.isEmpty()) {
        throw new Error('Cannot read this image')
      }
      let size = image.getSize()
      if (Math.max(size.width, size.height) > MAX_IMAGE_EDGE) {
        const scale = MAX_IMAGE_EDGE / Math.max(size.width, size.height)
        image = image.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'best'
        })
        size = image.getSize()
      }
      let data = image.toPNG()
      let mimeType: AgentImageAttachment['mimeType'] = 'image/png'
      if (data.byteLength > MAX_IMAGE_BYTES) {
        data = image.toJPEG(85)
        mimeType = 'image/jpeg'
      }
      if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('Image is too large to attach')
      }
      const id = randomUUID()
      const directory = agentMediaDirectory(threadId, id)
      const attachment: AgentImageAttachment = {
        id,
        threadId,
        name: path.basename(file).slice(0, 255),
        path: path.join(directory, `${id}.${mimeType === 'image/png' ? 'png' : 'jpg'}`),
        mimeType,
        createdAt: Date.now(),
        width: size.width,
        height: size.height
      }
      images.push(attachment)
      await mkdir(directory, { recursive: true })
      await writeFile(attachment.path, data, { flag: 'wx' })
    }
    return images
  } catch (error) {
    await removeAgentImageFiles(images)
    throw error
  }
}

/** Open the platform image picker; only files explicitly selected here are imported. */
export async function pickAgentImages(
  threadId: string,
  remaining: number
): Promise<AgentImageAttachment[]> {
  const options = {
    filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
    properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>
  }
  const window = BrowserWindow.getFocusedWindow()
  const selection = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  if (selection.canceled || !selection.filePaths.length) {
    return []
  }
  if (selection.filePaths.length > remaining) {
    throw new Error('Too many images selected')
  }
  return await importAgentImageFiles(threadId, selection.filePaths)
}

/** Delete only application-owned image copies, never the selected source files. */
export async function removeAgentImageFiles(images: AgentImageAttachment[]): Promise<void> {
  await Promise.all(
    images.map((image) =>
      rm(agentMediaDirectory(image.threadId, image.id), { recursive: true, force: true })
    )
  )
}

/** Resolve message image ids against their conversation before preparing SDK content. */
export async function readAgentMessageImages(
  thread: AgentThread,
  ids: string[] = []
): Promise<ImageContent[]> {
  return await Promise.all(
    ids.map(async (id) => {
      const image = thread.images?.find((item) => item.id === id && item.threadId === thread.id)
      if (!image) {
        throw new Error('Image does not belong to this conversation')
      }
      const file = await resolveAgentArtifact(thread.id, id)
      return {
        type: 'image' as const,
        data: (await readFile(file)).toString('base64'),
        mimeType: image.mimeType
      }
    })
  )
}
