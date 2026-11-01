import { useNavigate } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { DownloadSelectionModifiers } from '../../hooks/use-download-selection'
import { downloadLivePatchesAtom } from '../../store/download-live-patch'
import type { DownloadRecord } from '../../store/downloads'
import { DownloadItem } from './DownloadItem'

interface DownloadTaskTreeProps {
  contextIds?: Set<string>
  depth?: number
  download: DownloadRecord
  isTabStop?: boolean
  matchingIds: Set<string>
  onToggleSelect?: (id: string, modifiers?: DownloadSelectionModifiers) => void
  selectedIds?: Set<string>
  selectionActive?: boolean
  selectionContextMenu?: ReactNode
}

/**
 * Render one download row. Nested rows are separate virtual items, indented by depth.
 */
export function DownloadTaskTree({
  contextIds,
  depth = 0,
  download,
  isTabStop,
  matchingIds,
  onToggleSelect,
  selectedIds,
  selectionActive,
  selectionContextMenu
}: DownloadTaskTreeProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const patchAtom = useMemo(
    () => selectAtom(downloadLivePatchesAtom, (patches) => patches.get(download.id), Object.is),
    [download.id]
  )
  const patch = useAtomValue(patchAtom)
  const view = patch ? { ...download, ...patch } : download
  const showRecord = matchingIds.has(download.id) || Boolean(contextIds?.has(download.id))
  return (
    <div
      className={depth > 0 ? 'border-border/60 border-l' : undefined}
      style={depth > 0 ? { marginLeft: depth * 24 } : undefined}
    >
      {showRecord ? (
        <DownloadItem
          download={view}
          isSelected={selectedIds?.has(download.id)}
          isTabStop={isTabStop}
          onToggleSelect={matchingIds.has(download.id) ? onToggleSelect : undefined}
          selectionActive={selectionActive}
          selectionContextMenu={selectionContextMenu}
        />
      ) : (
        <button
          className="mx-6 my-3 max-w-[calc(100%-3rem)] truncate text-left text-muted-foreground text-xs hover:text-foreground"
          onClick={() => {
            void navigate({
              params: { downloadId: download.id },
              to: '/downloads/$downloadId/transcript'
            })
          }}
          type="button"
        >
          {t('download.sourceFile')}: {download.title}
        </button>
      )}
    </div>
  )
}
