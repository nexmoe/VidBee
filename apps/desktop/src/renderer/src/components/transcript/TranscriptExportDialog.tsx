import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Label } from '@renderer/components/ui/label'
import { Progress } from '@renderer/components/ui/progress'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { ipcEvents, ipcServices } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import type { TranscriptSegmentView } from '@renderer/store/transcripts'
import { buildAssDocument, buildSrtDocument } from '@shared/subtitle-export'
import {
  buildExportUnits,
  buildTranscriptExportFileName,
  buildTranscriptExportText,
  buildVideoSubtitleExportFileName,
  type TranscriptExportFormat,
  type TranscriptExportGrouping,
  type TranscriptExportStyle,
  type TranscriptVideoEncode
} from '@shared/transcript-export'
import { AlignLeft, Captions, Copy, FileText, Flame, Layers, List, Mic, Video } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface TranscriptExportDialogProps {
  isAudio?: boolean
  mediaPath?: string | null
  onOpenChange: (open: boolean) => void
  open: boolean
  resolveSpeaker: (speakerId: string | null) => string
  segments: TranscriptSegmentView[]
  title: string
  sourceUrl?: string | null
}

const STYLES: Array<{
  icon: typeof AlignLeft
  id: TranscriptExportStyle
}> = [
  { icon: AlignLeft, id: 'transcript' },
  { icon: Captions, id: 'subtitles' },
  { icon: List, id: 'segments' },
  { icon: Mic, id: 'whisper' },
  { icon: Video, id: 'video' }
]

const FORMATS: Array<{ icon: typeof FileText; id: TranscriptExportFormat }> = [
  { icon: FileText, id: 'txt' },
  { icon: FileText, id: 'md' }
]

const ENCODES: Array<{ icon: typeof Layers; id: TranscriptVideoEncode }> = [
  { icon: Layers, id: 'soft' },
  { icon: Flame, id: 'hard' }
]

const GROUPINGS: TranscriptExportGrouping[] = ['none', 'words', 'sentences']

/**
 * Preview and export a transcript as text, or as a video with subtitles.
 */
export function TranscriptExportDialog({
  isAudio = false,
  mediaPath = null,
  onOpenChange,
  open,
  resolveSpeaker,
  segments,
  title,
  sourceUrl
}: TranscriptExportDialogProps) {
  const { t } = useTranslation()
  const [style, setStyle] = useState<TranscriptExportStyle>('transcript')
  const [format, setFormat] = useState<TranscriptExportFormat>('txt')
  const [encode, setEncode] = useState<TranscriptVideoEncode>('soft')
  const [grouping, setGrouping] = useState<TranscriptExportGrouping>('none')
  const [showTimestamp, setShowTimestamp] = useState(true)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const isVideo = style === 'video'
  const videoBlocked = isVideo && (isAudio || !mediaPath)
  const units = useMemo(() => buildExportUnits(segments, grouping), [grouping, segments])
  const preview = useMemo(
    () =>
      buildTranscriptExportText({
        format,
        grouping,
        resolveSpeaker,
        segments,
        showTimestamp,
        style
      }),
    [format, grouping, resolveSpeaker, segments, showTimestamp, style]
  )

  useEffect(() => {
    if (!open) {
      setSaving(false)
      setProgress(null)
      return
    }
    const onProgress = (...args: unknown[]) => {
      const payload = args[0] as { percent?: number | null }
      setProgress(typeof payload?.percent === 'number' ? payload.percent : null)
    }
    const off = ipcEvents.on('transcript:export-progress', onProgress)
    return () => {
      ipcEvents.removeListener(
        'transcript:export-progress',
        (off as (...args: unknown[]) => void) ?? onProgress
      )
    }
  }, [open])

  const handleCopy = async () => {
    if (!preview) {
      toast.error(t('transcript.export.empty'))
      return
    }
    try {
      await navigator.clipboard.writeText(preview)
      toast.success(t('transcript.export.copied'))
    } catch {
      toast.error(t('transcript.export.copyFailed'))
    }
  }

  const handleExport = async () => {
    if (!preview) {
      toast.error(t('transcript.export.empty'))
      return
    }
    if (isVideo) {
      await exportVideo()
      return
    }
    setSaving(true)
    try {
      const saved = await ipcServices.fs.saveTextFile({
        content: preview,
        defaultFileName: buildTranscriptExportFileName(title, format, style === 'subtitles'),
        ...(format === 'md' && sourceUrl
          ? { source: { url: sourceUrl, label: t('transcript.info.url') } }
          : {})
      })
      if (!saved) {
        return
      }
      toast.success(t('transcript.export.saved'))
      onOpenChange(false)
      void ipcServices.fs.openFileLocation(saved.path)
    } catch {
      toast.error(t('transcript.export.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  /**
   * Mux or burn the current cues into a new video file.
   */
  const exportVideo = async () => {
    if (!mediaPath || isAudio) {
      toast.error(t(isAudio ? 'transcript.export.audioOnly' : 'transcript.export.noMedia'))
      return
    }
    setSaving(true)
    setProgress(null)
    try {
      const subtitleText = encode === 'hard' ? buildAssDocument(units) : buildSrtDocument(units)
      const result = await ipcServices.transcript.exportVideo({
        defaultFileName: buildVideoSubtitleExportFileName(title, encode),
        mode: encode,
        sourcePath: mediaPath,
        subtitleText
      })
      if (result.status === 'canceled') {
        toast.info(t('transcript.export.cancelled'))
        return
      }
      if (result.status === 'unavailable') {
        toast.error(
          t(
            result.reason === 'audio-only'
              ? 'transcript.export.audioOnly'
              : 'transcript.export.noMedia'
          )
        )
        return
      }
      if (result.status === 'failed') {
        toast.error(t('transcript.export.videoSaveFailed'))
        return
      }
      toast.success(t('transcript.export.videoSaved'))
      onOpenChange(false)
      void ipcServices.fs.openFileLocation(result.path)
    } catch {
      toast.error(t('transcript.export.videoSaveFailed'))
    } finally {
      setSaving(false)
      setProgress(null)
    }
  }

  /**
   * Close the dialog, cancelling an in-flight video export first.
   */
  const handleOpenChange = (next: boolean) => {
    if (!next && saving && isVideo) {
      ipcServices.transcript.cancelVideoExport()
    }
    if (!next && saving && !isVideo) {
      return
    }
    onOpenChange(next)
  }

  const formatBadge = isVideo
    ? t(`transcript.export.encode.${encode}`)
    : t(`transcript.export.format.${format}`)
  const previewMessage = videoBlocked
    ? t(isAudio ? 'transcript.export.audioOnly' : 'transcript.export.noMedia')
    : preview || t('transcript.export.empty')
  const canExport = Boolean(preview) && !saving && !videoBlocked
  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
        showCloseButton={false}
      >
        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_17.5rem]">
          <div className="flex min-h-0 flex-col border-r p-6">
            <DialogHeader className="gap-3">
              <div className="flex items-center justify-between gap-3">
                <DialogTitle>{t('transcript.export.preview')}</DialogTitle>
                <div className="flex items-center gap-1.5">
                  <Badge variant="secondary">{t(`transcript.export.style.${style}`)}</Badge>
                  <Badge variant="secondary">{formatBadge}</Badge>
                </div>
              </div>
              <DialogDescription className="sr-only">
                {t('transcript.export.description')}
              </DialogDescription>
            </DialogHeader>
            {isVideo ? (
              <p className="mt-4 text-muted-foreground text-xs leading-relaxed">
                {t(`transcript.export.${encode}Hint`)}
              </p>
            ) : null}
            <ScrollArea className="mt-4 h-[min(52vh,28rem)] rounded-md border">
              <pre className="whitespace-pre-wrap p-4 font-sans text-sm leading-relaxed">
                {previewMessage}
              </pre>
            </ScrollArea>
          </div>

          <div className="flex min-h-0 flex-col gap-6 overflow-y-auto p-6">
            <section className="space-y-3">
              <h3 className="font-medium text-sm">{t('transcript.export.styleLabel')}</h3>
              <div className="grid grid-cols-3 gap-2">
                {STYLES.map((item) => {
                  const Icon = item.icon
                  const selected = style === item.id
                  return (
                    <Button
                      aria-pressed={selected}
                      className={cn(
                        'h-auto flex-col gap-2 px-2 py-3 font-normal',
                        selected && 'border-primary bg-primary/5'
                      )}
                      data-testid={`transcript-export-style-${item.id}`}
                      disabled={saving}
                      key={item.id}
                      onClick={() => setStyle(item.id)}
                      type="button"
                      variant="outline"
                    >
                      <Icon />
                      <span className="text-xs">{t(`transcript.export.style.${item.id}`)}</span>
                    </Button>
                  )
                })}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="font-medium text-sm">
                {t(isVideo ? 'transcript.export.encodeLabel' : 'transcript.export.formatLabel')}
              </h3>
              <div className={cn('grid gap-2', isVideo ? 'grid-cols-2' : 'grid-cols-3')}>
                {(isVideo ? ENCODES : FORMATS).map((item) => {
                  const Icon = item.icon
                  const selected = isVideo ? encode === item.id : format === item.id
                  return (
                    <Button
                      aria-pressed={selected}
                      className={cn(
                        'h-auto flex-col gap-2 px-2 py-3 font-normal',
                        selected && 'border-primary bg-primary/5'
                      )}
                      data-testid={
                        isVideo
                          ? `transcript-export-encode-${item.id}`
                          : `transcript-export-format-${item.id}`
                      }
                      disabled={saving}
                      key={item.id}
                      onClick={() => {
                        if (isVideo) {
                          setEncode(item.id as TranscriptVideoEncode)
                          return
                        }
                        setFormat(item.id as TranscriptExportFormat)
                      }}
                      type="button"
                      variant="outline"
                    >
                      <Icon />
                      <span className="text-xs">
                        {isVideo
                          ? t(`transcript.export.encode.${item.id}`)
                          : t(`transcript.export.format.${item.id}`)}
                      </span>
                      {isVideo ? (
                        <span className="text-[10px] text-muted-foreground">
                          {item.id === 'soft' ? '.mkv' : '.mp4'}
                        </span>
                      ) : null}
                    </Button>
                  )
                })}
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="font-medium text-sm">{t('transcript.export.options')}</h3>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="transcript-export-grouping">
                  {t('transcript.export.grouping')}
                </Label>
                <Select
                  disabled={saving}
                  onValueChange={(value) => setGrouping(value as TranscriptExportGrouping)}
                  value={grouping}
                >
                  <SelectTrigger className="w-36" id="transcript-export-grouping">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[60]">
                    {GROUPINGS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`transcript.export.groupingValue.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isVideo ? null : (
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="transcript-export-timestamp">
                    {t('transcript.export.showTimestamp')}
                  </Label>
                  <Switch
                    checked={showTimestamp}
                    disabled={saving}
                    id="transcript-export-timestamp"
                    label=""
                    onToggle={() => setShowTimestamp((current) => !current)}
                  />
                </div>
              )}
            </section>
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4 sm:justify-between">
          <DialogClose asChild>
            <Button disabled={saving && !isVideo} type="button" variant="outline">
              {saving && isVideo
                ? t('transcript.export.cancelExport')
                : t('transcript.export.close')}
            </Button>
          </DialogClose>
          <div className="flex items-center gap-2">
            {saving && isVideo ? (
              <div className="mr-2 flex min-w-28 flex-col gap-1">
                <Progress value={progress ?? 0} />
                <span className="text-muted-foreground text-xs">
                  {progress === null
                    ? t('transcript.export.exporting')
                    : t('transcript.export.progress', { percent: progress })}
                </span>
              </div>
            ) : null}
            <Button
              aria-label={t('transcript.export.copy')}
              disabled={saving || !preview || videoBlocked}
              onClick={() => void handleCopy()}
              size="icon"
              type="button"
              variant="outline"
            >
              <Copy />
            </Button>
            <Button
              data-testid="transcript-export-action"
              disabled={!canExport}
              onClick={() => void handleExport()}
              type="button"
            >
              {saving ? t('transcript.export.exporting') : t('transcript.export.action')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
