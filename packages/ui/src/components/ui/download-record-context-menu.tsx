import { Copy, File, FolderOpen, ListPlus, Pause, Play, RotateCw, Trash2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ContextMenuItem, ContextMenuSeparator } from './context-menu'

export interface DownloadRecordContextMenuItemsProps {
  canCopyLink: boolean
  canCopyToClipboard: boolean
  canDeleteFile: boolean
  canDeleteRecord: boolean
  canOpenFile: boolean
  canPauseDownload: boolean
  canResumeDownload: boolean
  canRetry: boolean
  canShowOpenFolder: boolean
  extraItems?: ReactNode
  isInProgressStatus: boolean
  onAddToPlaylist?: () => void
  onCancel: () => void
  onCopyLink: () => void
  onCopyToClipboard: () => void
  onDeleteFile: () => void
  onDeleteRecord: () => void
  onOpenFile: () => void
  onOpenFolder: () => void
  onPause: () => void
  onResume: () => void
  onRetry: () => void
  onTranscriptRetry?: () => void
  showAddToPlaylist?: boolean
  showCopyToClipboard?: boolean
  showOpenFile?: boolean
  showOpenFolder?: boolean
  showTranscriptRetry?: boolean
}

/**
 * Shared download-record menu used by list rows and the playlist overflow.
 */
export function DownloadRecordContextMenuItems({
  canCopyLink,
  canCopyToClipboard,
  canDeleteFile,
  canDeleteRecord,
  canOpenFile,
  canPauseDownload,
  canResumeDownload,
  canRetry,
  canShowOpenFolder,
  extraItems,
  isInProgressStatus,
  onAddToPlaylist,
  onCancel,
  onCopyLink,
  onCopyToClipboard,
  onDeleteFile,
  onDeleteRecord,
  onOpenFile,
  onOpenFolder,
  onPause,
  onResume,
  onRetry,
  onTranscriptRetry,
  showAddToPlaylist = false,
  showCopyToClipboard = true,
  showOpenFile = true,
  showOpenFolder = true,
  showTranscriptRetry = false
}: DownloadRecordContextMenuItemsProps): ReactNode {
  const { t } = useTranslation()
  return (
    <>
      {showOpenFile ? (
        <ContextMenuItem disabled={!canOpenFile} onClick={onOpenFile}>
          <File className="h-4 w-4" />
          {t('history.openFile')}
        </ContextMenuItem>
      ) : null}
      {showAddToPlaylist ? (
        <ContextMenuItem onClick={onAddToPlaylist}>
          <ListPlus className="h-4 w-4" />
          {t('transcript.player.playlist.add')}
        </ContextMenuItem>
      ) : null}
      {showTranscriptRetry ? (
        <ContextMenuItem onClick={onTranscriptRetry}>
          <RotateCw className="h-4 w-4" />
          {t('transcript.retry')}
        </ContextMenuItem>
      ) : null}
      {showOpenFolder || showCopyToClipboard ? <ContextMenuSeparator /> : null}
      {showOpenFolder ? (
        <ContextMenuItem disabled={!canShowOpenFolder} onClick={onOpenFolder}>
          <FolderOpen className="h-4 w-4" />
          {t('history.openFileLocation')}
        </ContextMenuItem>
      ) : null}
      {showCopyToClipboard ? (
        <ContextMenuItem disabled={!canCopyToClipboard} onClick={onCopyToClipboard}>
          <Copy className="h-4 w-4" />
          {t('history.copyToClipboard')}
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem disabled={!canCopyLink} onClick={onCopyLink}>
        <span aria-hidden className="h-4 w-4 shrink-0" />
        {t('history.copyUrl')}
      </ContextMenuItem>
      {extraItems}
      {canRetry || canResumeDownload || canPauseDownload || isInProgressStatus ? (
        <>
          <ContextMenuSeparator />
          {canRetry ? (
            <ContextMenuItem onClick={onRetry}>
              <RotateCw className="h-4 w-4" />
              {t('download.retry')}
            </ContextMenuItem>
          ) : null}
          {canResumeDownload ? (
            <ContextMenuItem onClick={onResume}>
              <Play className="h-4 w-4" />
              {t('download.resume')}
            </ContextMenuItem>
          ) : null}
          {canPauseDownload ? (
            <ContextMenuItem onClick={onPause}>
              <Pause className="h-4 w-4" />
              {t('download.pause')}
            </ContextMenuItem>
          ) : null}
          {isInProgressStatus ? (
            <ContextMenuItem onClick={onCancel}>
              <X className="h-4 w-4" />
              {t('download.cancel')}
            </ContextMenuItem>
          ) : null}
        </>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!canDeleteFile} onClick={onDeleteFile}>
        <Trash2 className="h-4 w-4" />
        {t('history.deleteFile')}
      </ContextMenuItem>
      <ContextMenuItem disabled={!canDeleteRecord} onClick={onDeleteRecord}>
        <span aria-hidden className="h-4 w-4 shrink-0" />
        {t('history.deleteRecord')}
      </ContextMenuItem>
    </>
  )
}
