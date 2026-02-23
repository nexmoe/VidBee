import { oc } from '@orpc/contract'
import {
  CancelDownloadInputSchema,
  CancelDownloadOutputSchema,
  CreateDownloadInputSchema,
  CreateDownloadOutputSchema,
  ListDownloadsOutputSchema,
  ListHistoryOutputSchema,
  StatusOutputSchema,
  VideoInfoInputSchema,
  VideoInfoOutputSchema
} from './schemas'

export const downloaderContract = {
  status: oc.output(StatusOutputSchema),
  videoInfo: oc.input(VideoInfoInputSchema).output(VideoInfoOutputSchema),
  downloads: {
    create: oc.input(CreateDownloadInputSchema).output(CreateDownloadOutputSchema),
    list: oc.output(ListDownloadsOutputSchema),
    cancel: oc.input(CancelDownloadInputSchema).output(CancelDownloadOutputSchema)
  },
  history: {
    list: oc.output(ListHistoryOutputSchema)
  }
}
