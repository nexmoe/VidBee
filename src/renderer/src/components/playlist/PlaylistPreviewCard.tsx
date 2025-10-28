import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import type { PlaylistEntry, PlaylistInfo } from '@shared/types'
import { useTranslation } from 'react-i18next'

interface PlaylistPreviewCardProps {
  playlist: PlaylistInfo
  entries: PlaylistEntry[]
  onClear?: () => void
}

export function PlaylistPreviewCard({ playlist, entries, onClear }: PlaylistPreviewCardProps) {
  const { t } = useTranslation()

  const totalCount = playlist.entryCount
  const selectedCount = entries.length
  const firstIndex = entries[0]?.index ?? null
  const lastIndex = entries[entries.length - 1]?.index ?? firstIndex ?? null

  return (
    <Card className="border border-border/60 bg-background/80 shadow-sm overflow-hidden">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle
            className="truncate text-base font-semibold sm:text-lg wrap-break-word"
            title={playlist.title}
          >
            {playlist.title || t('playlist.untitled')}
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground sm:text-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs text-muted-foreground sm:text-sm">
              <span className="truncate">{t('playlist.totalVideos', { count: totalCount })}</span>
              {firstIndex !== null && lastIndex !== null ? (
                <span className="truncate">
                  {t('playlist.selectedRange', {
                    start: firstIndex,
                    end: lastIndex
                  })}
                </span>
              ) : (
                <span className="truncate">{t('playlist.noRangeSelected')}</span>
              )}
              <span className="truncate">
                {t('playlist.showingCount', { count: selectedCount })}
              </span>
            </div>
          </CardDescription>
        </div>
        {onClear && (
          <Button variant="ghost" size="sm" onClick={onClear} className="shrink-0">
            {t('playlist.clearPreview')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-border/60 bg-muted/20">
          <ScrollArea className="max-h-64 w-full pr-1 overflow-y-auto overflow-x-hidden">
            <ol className="w-full min-w-0 divide-y divide-border/60 text-sm leading-snug">
              {entries.length === 0 ? (
                <li className="px-4 py-6 text-center text-xs text-muted-foreground">
                  {t('playlist.noEntriesInRange')}
                </li>
              ) : (
                entries.map((entry) => (
                  <li
                    key={`${entry.index}-${entry.id}`}
                    className="flex items-start gap-3 px-4 py-2 min-w-0 w-full max-w-full overflow-hidden"
                  >
                    <span className="w-12 shrink-0 text-xs font-semibold text-muted-foreground text-center">
                      #{entry.index}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-sm overflow-hidden wrap-break-word"
                      title={entry.title}
                    >
                      {entry.title}
                    </span>
                  </li>
                ))
              )}
            </ol>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  )
}
