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
        <div className="flex-1 flex flex-col items-center justify-center gap-3 min-h-[200px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t('playlist.fetchingInfo')}</p>
        </div>
      )}

      {playlistPreviewError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 mb-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium text-destructive">{t('playlist.previewFailed')}</p>
              <p className="text-xs text-muted-foreground/80">{playlistPreviewError}</p>
            </div>
          </div>
        </div>
      )}

      {playlistInfo && !playlistPreviewLoading && (
        <div className="flex-1 flex flex-col min-h-0 gap-3">
          <div className="space-y-0.5 shrink-0">
            <h3 className="font-bold text-sm leading-tight line-clamp-1">{playlistInfo.title}</h3>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <List className="h-3 w-3" />
              <span>{t('playlist.foundVideos', { count: playlistInfo.entryCount })}</span>
              {selectedPlaylistEntries.length !== playlistInfo.entryCount && (
                <>
                  <span>•</span>
                  <span className="text-primary font-medium">
                    {t('playlist.selectedVideos', { count: selectedPlaylistEntries.length })}
                  </span>
                </>
              )}
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0 w-full rounded-md border">
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
                    key={entry.id}
                    type="button"
                    className={cn(
                      'flex items-center gap-3 px-2.5 py-1.5 rounded transition-colors cursor-pointer w-full text-left',
                      isSelected || isInRange ? 'bg-primary/10' : 'hover:bg-muted/50'
                    )}
                    onClick={handleToggle}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handleToggle()
                      }
                    }}
                    aria-label={t('playlist.selectEntry', { index: entry.index })}
                  >
                    <Checkbox
                      checked={isSelected || isInRange}
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
                      className="shrink-0"
                    />
                    <div className="shrink-0 w-8 text-xs font-medium text-muted-foreground/70 tabular-nums">
                      #{entry.index}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium line-clamp-1 leading-tight">
                        {entry.title || t('download.fetchingVideoInfo')}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </ScrollArea>

          <div
            data-state={advancedOptionsOpen ? 'open' : 'closed'}
            className={cn(
              'grid overflow-hidden transition-all duration-300 ease-out shrink-0',
              advancedOptionsOpen ? 'grid-rows-[1fr] py-3 opacity-100' : 'grid-rows-[0fr] opacity-0'
            )}
            aria-hidden={!advancedOptionsOpen}
          >
            <div className={cn('min-h-0', !advancedOptionsOpen && 'pointer-events-none')}>
              <div className="w-full pt-3 border-t">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label
                        htmlFor={downloadTypeId}
                        className="text-xs font-medium text-muted-foreground"
                      >
                        {t('playlist.downloadType')}
                      </Label>
                      <Select
                        value={downloadType}
                        onValueChange={(value) => setDownloadType(value as 'video' | 'audio')}
                        disabled={playlistBusy}
                      >
                        <SelectTrigger id={downloadTypeId} className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="video" className="text-xs">
                            {t('download.video')}
                          </SelectItem>
                          <SelectItem value="audio" className="text-xs">
                            {t('download.audio')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">
                        {t('playlist.range')}
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="1"
                          value={startIndex}
                          onChange={(event) => {
                            setStartIndex(event.target.value)
                            if (selectedEntryIds.size > 0) {
                              setSelectedEntryIds(new Set())
                            }
                          }}
                          className="text-center h-8 text-xs"
                          disabled={playlistBusy}
                        />
                        <span className="text-muted-foreground text-xs">-</span>
                        <Input
                          placeholder={playlistInfo?.entryCount.toString() || 'End'}
                          value={endIndex}
                          onChange={(event) => {
                            setEndIndex(event.target.value)
                            if (selectedEntryIds.size > 0) {
                              setSelectedEntryIds(new Set())
                            }
                          }}
                          className="text-center h-8 text-xs"
                          disabled={playlistBusy}
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
