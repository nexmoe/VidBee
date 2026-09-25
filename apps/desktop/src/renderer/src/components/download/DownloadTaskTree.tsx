import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { DownloadRecord } from '../../store/downloads'
import { DownloadItem } from './DownloadItem'

interface DownloadTaskTreeProps {
  download: DownloadRecord
  childrenByParent: Map<string, DownloadRecord[]>
  matchingIds: Set<string>
  contextIds?: Set<string>
  selectedIds?: Set<string>
  selectionActive?: boolean
  onToggleSelect?: (id: string) => void
}

/** Nest derived media beneath its source, including a non-selectable source when filtered out. */
export function DownloadTaskTree({
  download,
  childrenByParent,
  matchingIds,
  contextIds,
  selectedIds,
  selectionActive,
  onToggleSelect
}: DownloadTaskTreeProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const children = childrenByParent.get(download.id) ?? []
  return (
    <div>
      {matchingIds.has(download.id) || contextIds?.has(download.id) ? (
        <DownloadItem
          download={download}
          isSelected={selectedIds?.has(download.id)}
          onToggleSelect={matchingIds.has(download.id) ? onToggleSelect : undefined}
          selectionActive={selectionActive}
        />
      ) : (
        <button
          className="mx-6 my-3 max-w-[calc(100%-3rem)] truncate text-left text-muted-foreground text-xs hover:text-foreground"
          onClick={() => {
            void navigate({
              to: '/downloads/$downloadId/transcript',
              params: { downloadId: download.id }
            })
          }}
          type="button"
        >
          {t('download.sourceFile')}: {download.title}
        </button>
      )}
      {children.length > 0 && (
        <div className="ml-6 border-border/60 border-l pl-3">
          {children.map((child) => (
            <DownloadTaskTree
              childrenByParent={childrenByParent}
              contextIds={contextIds}
              download={child}
              key={child.id}
              matchingIds={matchingIds}
              onToggleSelect={onToggleSelect}
              selectedIds={selectedIds}
              selectionActive={selectionActive}
            />
          ))}
        </div>
      )}
    </div>
  )
}
