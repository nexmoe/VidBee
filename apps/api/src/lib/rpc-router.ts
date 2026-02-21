import { implement, ORPCError } from '@orpc/server'
import { downloaderContract } from '@vidbee/downloader-core'
import { downloaderCore } from './downloader'

const os = implement(downloaderContract)

const toErrorMessage = (error: unknown, fallbackMessage: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return fallbackMessage
}

export const rpcRouter = os.router({
  status: os.status.handler(() => {
    const status = downloaderCore.getStatus()
    return {
      ok: true,
      version: '1.0.0',
      active: status.active,
      pending: status.pending
    }
  }),
  videoInfo: os.videoInfo.handler(async (args: { input: { url: string } }) => {
    const { input } = args

    try {
      const video = await downloaderCore.getVideoInfo(input.url)
      return { video }
    } catch (error) {
      throw new ORPCError('BAD_REQUEST', {
        message: toErrorMessage(error, 'Failed to fetch video info.')
      })
    }
  }),
  downloads: {
    create: os.downloads.create.handler(
      async (args: { input: { url: string; type: 'video' | 'audio'; format?: string } }) => {
        const { input } = args

        try {
          const download = await downloaderCore.createDownload(input)
          return { download }
        } catch (error) {
          throw new ORPCError('BAD_REQUEST', {
            message: toErrorMessage(error, 'Failed to create download.')
          })
        }
      }
    ),
    list: os.downloads.list.handler(() => {
      return {
        downloads: downloaderCore.listDownloads()
      }
    }),
    cancel: os.downloads.cancel.handler(async (args: { input: { id: string } }) => {
      const { input } = args

      try {
        const cancelled = await downloaderCore.cancelDownload(input.id)
        return { cancelled }
      } catch (error) {
        throw new ORPCError('BAD_REQUEST', {
          message: toErrorMessage(error, 'Failed to cancel download.')
        })
      }
    })
  },
  history: {
    list: os.history.list.handler(() => {
      return {
        history: downloaderCore.listHistory()
      }
    })
  }
})
