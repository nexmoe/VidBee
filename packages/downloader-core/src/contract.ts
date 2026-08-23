import { oc } from '@orpc/contract'
import {
  CancelDownloadInputSchema,
  CancelDownloadOutputSchema,
  CreateDownloadInputSchema,
  CreateDownloadOutputSchema,
  DirectoryListInputSchema,
  FileExistsOutputSchema,
  FileOperationOutputSchema,
  FilePathInputSchema,
  GetWebSettingsOutputSchema,
  ListDirectoriesOutputSchema,
  ListDownloadsOutputSchema,
  ListHistoryOutputSchema,
  PauseDownloadInputSchema,
  PauseDownloadOutputSchema,
  PlaylistDownloadInputSchema,
  PlaylistDownloadOutputSchema,
  PlaylistInfoInputSchema,
  PlaylistInfoOutputSchema,
  RemoveHistoryByPlaylistInputSchema,
  RemoveHistoryItemsInputSchema,
  RemoveHistoryOutputSchema,
  ResumeDownloadInputSchema,
  ResumeDownloadOutputSchema,
  RetryDownloadInputSchema,
  RetryDownloadOutputSchema,
  SetWebSettingsInputSchema,
  StatusOutputSchema,
  UploadSettingsFileInputSchema,
  UploadSettingsFileOutputSchema,
  VideoInfoInputSchema,
  VideoInfoOutputSchema
} from './schemas'

export const downloaderContract = {
  status: oc.output(StatusOutputSchema),
  videoInfo: oc.input(VideoInfoInputSchema).output(VideoInfoOutputSchema),
  playlist: {
    info: oc.input(PlaylistInfoInputSchema).output(PlaylistInfoOutputSchema),
    download: oc.input(PlaylistDownloadInputSchema).output(PlaylistDownloadOutputSchema)
  },
  downloads: {
    create: oc.input(CreateDownloadInputSchema).output(CreateDownloadOutputSchema),
    list: oc.output(ListDownloadsOutputSchema),
    cancel: oc.input(CancelDownloadInputSchema).output(CancelDownloadOutputSchema),
    pause: oc.input(PauseDownloadInputSchema).output(PauseDownloadOutputSchema),
    resume: oc.input(ResumeDownloadInputSchema).output(ResumeDownloadOutputSchema),
    retry: oc.input(RetryDownloadInputSchema).output(RetryDownloadOutputSchema)
  },
  history: {
    list: oc.output(ListHistoryOutputSchema),
    removeItems: oc.input(RemoveHistoryItemsInputSchema).output(RemoveHistoryOutputSchema),
    removeByPlaylist: oc.input(RemoveHistoryByPlaylistInputSchema).output(RemoveHistoryOutputSchema)
  },
  files: {
    exists: oc.input(FilePathInputSchema).output(FileExistsOutputSchema),
    listDirectories: oc.input(DirectoryListInputSchema).output(ListDirectoriesOutputSchema),
    openFile: oc.input(FilePathInputSchema).output(FileOperationOutputSchema),
    openFileLocation: oc.input(FilePathInputSchema).output(FileOperationOutputSchema),
    copyFileToClipboard: oc.input(FilePathInputSchema).output(FileOperationOutputSchema),
    deleteFile: oc.input(FilePathInputSchema).output(FileOperationOutputSchema),
    uploadSettingsFile: oc
      .input(UploadSettingsFileInputSchema)
      .output(UploadSettingsFileOutputSchema)
  },
  settings: {
    get: oc.output(GetWebSettingsOutputSchema),
    set: oc.input(SetWebSettingsInputSchema).output(GetWebSettingsOutputSchema)
  }
}
