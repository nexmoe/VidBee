import {
  DownloadRecordContextMenuItems as SharedDownloadRecordContextMenuItems,
  type DownloadRecordContextMenuItemsProps as SharedDownloadRecordContextMenuItemsProps
} from '@vidbee/ui/components/ui/download-record-context-menu'
import type { ReactNode } from 'react'

export type DownloadRecordContextMenuItemsProps = SharedDownloadRecordContextMenuItemsProps

/**
 * Shared download-record menu used by list rows and the playlist overflow.
 */
export function DownloadRecordContextMenuItems(
  props: DownloadRecordContextMenuItemsProps
): ReactNode {
  return (
    <SharedDownloadRecordContextMenuItems
      {...props}
      showAddToPlaylist={props.showAddToPlaylist ?? true}
    />
  )
}
