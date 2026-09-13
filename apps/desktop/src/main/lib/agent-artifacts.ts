import { copyFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { dialog, net, protocol } from 'electron'
import { getAgentChatStore } from './agent-chat-store'
import { agentMediaDirectory } from './agent-media'

/** Resolve an artifact identifier after validating both its owner and actual filesystem location. */
export async function resolveAgentArtifact(
  threadId: string,
  artifactId: string,
  poster = false
): Promise<string> {
  const thread = getAgentChatStore().get(threadId)
  const artifact = thread?.artifacts.find(
    (item) => item.id === artifactId && item.threadId === threadId
  )
  const image = thread?.images?.find((item) => item.id === artifactId && item.threadId === threadId)
  const attachment = artifact ?? image
  if (!attachment) {
    throw new Error('Attachment does not belong to this conversation')
  }
  const file = poster && artifact ? (artifact.posterPath ?? artifact.path) : attachment.path
  const directory = await realpath(agentMediaDirectory(threadId, artifact?.runId ?? attachment.id))
  const resolved = await realpath(file)
  if (!resolved.startsWith(`${directory}${path.sep}`)) {
    throw new Error('Attachment path is outside its owner directory')
  }
  return resolved
}

/** Expose only database-owned media, with native range support for video playback. */
export function registerAgentArtifactProtocol(): void {
  protocol.handle('agent-artifact', async (request) => {
    try {
      const url = new URL(request.url)
      const artifactId = url.pathname.slice(1)
      if (!(/^[0-9a-f-]{36}$/.test(url.hostname) && /^[0-9a-f-]{36}$/.test(artifactId))) {
        return new Response(null, { status: 404 })
      }
      const file = await resolveAgentArtifact(
        url.hostname,
        artifactId,
        url.searchParams.get('poster') === '1'
      )
      return await net.fetch(pathToFileURL(file).href, { headers: request.headers })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}

/** Save an artifact through an explicit user destination selection. */
export async function saveAgentArtifact(threadId: string, artifactId: string): Promise<boolean> {
  const file = await resolveAgentArtifact(threadId, artifactId)
  const result = await dialog.showSaveDialog({ defaultPath: path.basename(file) })
  if (result.canceled || !result.filePath) {
    return false
  }
  if (path.resolve(result.filePath) === path.resolve(file)) {
    return true
  }
  await copyFile(file, result.filePath)
  return true
}
