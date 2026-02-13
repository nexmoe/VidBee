import { Checkbox } from '@renderer/components/ui/checkbox'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { cn } from '@renderer/lib/utils'
import type { PlaylistInfo } from '@shared/types'
import { AlertCircle, List, Loader2 } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'

interface PlaylistDownloadProps {
  playlistPreviewLoading: boolean
  playlistPreviewError: string | null
  playlistInfo: PlaylistInfo | null
  playlistBusy: boolean
  selectedPlaylistEntries: PlaylistInfo['entries']
  selectedEntryIds: Set<string>
  downloadType: 'video' | 'audio'
  downloadTypeId: string
  startIndex: string
  endIndex: string
  advancedOptionsOpen: boolean
  setSelectedEntryIds: Dispatch<SetStateAction<Set<string>>>
  setStartIndex: Dispatch<SetStateAction<string>>
  setEndIndex: Dispatch<SetStateAction<string>>
  setDownloadType: Dispatch<SetStateAction<'video' | 'audio'>>
}

export function PlaylistDownload({
  playlistPreviewLoading,
  playlistPreviewError,
  playlistInfo,
  playlistBusy,
  selectedPlaylistEntries,
  selectedEntryIds,
  downloadType,
  downloadTypeId,
  startIndex,
  endIndex,
  advancedOptionsOpen,
  setSelectedEntryIds,
  setStartIndex,
  setEndIndex,
  setDownloadType
}: PlaylistDownloadProps) {
  const { t } = useTranslation()

  return (
    <>
      {playlistPreviewLoading && !playlistPreviewError && (
        <div className="flex min-h-[200px] flex-1 flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">{t('playlist.fetchingInfo')}</p>
        </div>
      )}

      {playlistPreviewError && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="flex-1 space-y-1">
              <p className="font-medium text-destructive text-sm">{t('playlist.previewFailed')}</p>
              <p className="text-muted-foreground/80 text-xs">{playlistPreviewError}</p>
            </div>
          </div>
        </div>
      )}

      {playlistInfo && !playlistPreviewLoading && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="shrink-0 space-y-0.5">
            <h3 className="line-clamp-1 font-bold text-sm leading-tight">{playlistInfo.title}</h3>
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <List className="h-3 w-3" />
              <span>{t('playlist.foundVideos', { count: playlistInfo.entryCount })}</span>
              {selectedPlaylistEntries.length !== playlistInfo.entryCount && (
                <>
                  <span>•</span>
                  <span className="font-medium text-primary">
                    {t('playlist.selectedVideos', { count: selectedPlaylistEntries.length })}
                  </span>
                </>
              )}
            </div>
          </div>

          <ScrollArea className="min-h-0 w-full flex-1 rounded-md border">
            <div className="p-1">
              {playlistInfo.entries.map((entry) => {
                const isSelected = selectedEntryIds.has(entry.id)
                const isInRange =
                  selectedEntryIds.size === 0 &&
                  selectedPlaylistEntries.some((playlistEntry) => playlistEntry.id === entry.id)

                const handleToggle = () => {
                  setSelectedEntryIds((prev) => {
                    const next = new Set(prev)
                    if (next.has(entry.id)) {
                      next.delete(entry.id)
                    } else {
                      next.add(entry.id)
                    }
                    return next
                  })
                  if (selectedEntryIds.size === 0) {
                    setStartIndex('1')
                    setEndIndex('')
                  }
                }

                return (
                  <button
                    aria-label={t('playlist.selectEntry', { index: entry.index })}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-3 rounded px-2.5 py-1.5 text-left transition-colors',
                      isSelected || isInRange ? 'bg-primary/10' : 'hover:bg-muted/50'
                    )}
                    key={entry.id}
                    onClick={handleToggle}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handleToggle()
                      }
                    }}
                    type="button"
                  >
                    <Checkbox
                      checked={isSelected || isInRange}
                      className="shrink-0"
                      onCheckedChange={(checked) => {
                        setSelectedEntryIds((prev) => {
                          const next = new Set(prev)
                          if (checked) {
                            next.add(entry.id)
                          } else {
                            next.delete(entry.id)
                          }
                          return next
                        })
                        if (selectedEntryIds.size === 0) {
                          setStartIndex('1')
                          setEndIndex('')
                        }
                      }}
                      onClick={(event) => event.stopPropagation()}
                    />
                    <div className="w-8 shrink-0 font-medium text-muted-foreground/70 text-xs tabular-nums">
                      #{entry.index}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 font-medium text-xs leading-tight">
                        {entry.title || t('download.fetchingVideoInfo')}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </ScrollArea>

          <div
            aria-hidden={!advancedOptionsOpen}
            className={cn(
              'grid shrink-0 overflow-hidden transition-all duration-300 ease-out',
              advancedOptionsOpen ? 'grid-rows-[1fr] py-3 opacity-100' : 'grid-rows-[0fr] opacity-0'
            )}
            data-state={advancedOptionsOpen ? 'open' : 'closed'}
          >
            <div className={cn('min-h-0', !advancedOptionsOpen && 'pointer-events-none')}>
              <div className="w-full border-t pt-3">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label
                        className="font-medium text-muted-foreground text-xs"
                        htmlFor={downloadTypeId}
                      >
                        {t('playlist.downloadType')}
                      </Label>
                      <Select
                        disabled={playlistBusy}
                        onValueChange={(value) => setDownloadType(value as 'video' | 'audio')}
                        value={downloadType}
                      >
                        <SelectTrigger className="h-8 text-xs" id={downloadTypeId}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem className="text-xs" value="video">
                            {t('download.video')}
                          </SelectItem>
                          <SelectItem className="text-xs" value="audio">
                            {t('download.audio')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="font-medium text-muted-foreground text-xs">
                        {t('playlist.range')}
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          className="h-8 text-center text-xs"
                          disabled={playlistBusy}
                          onChange={(event) => {
                            setStartIndex(event.target.value)
                            if (selectedEntryIds.size > 0) {
                              setSelectedEntryIds(new Set())
                            }
                          }}
                          placeholder="1"
                          value={startIndex}
                        />
                        <span className="text-muted-foreground text-xs">-</span>
                        <Input
                          className="h-8 text-center text-xs"
                          disabled={playlistBusy}
                          onChange={(event) => {
                            setEndIndex(event.target.value)
                            if (selectedEntryIds.size > 0) {
                              setSelectedEntryIds(new Set())
                            }
                          }}
                          placeholder={playlistInfo?.entryCount.toString() || 'End'}
                          value={endIndex}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
