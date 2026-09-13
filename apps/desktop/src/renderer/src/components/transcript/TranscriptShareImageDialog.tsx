import { AgentResponseShareCard } from '@renderer/components/transcript/AgentResponseShareCard'
import { SHARE_CARD_WIDTH } from '@renderer/components/transcript/TranscriptShareCardChrome'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Input } from '@renderer/components/ui/input'
import { captureShareImageBlob, copyShareImageBlob } from '@renderer/lib/capture-prompt-share'
import { ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import { cn } from '@renderer/lib/utils'
import type { ShareCardPayload } from '@shared/types/share-card'
import { Copy, Download, Loader2, Share2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type ShareAction = 'copy' | 'download' | 'share'

const MAC_SHARE_UA = /Mac|darwin/i
/** Standalone pill chrome for each share-dialog action. */
const shareActionClassName =
  'h-10 w-full min-w-0 rounded-full border-border/70 bg-background/95 px-5 shadow-lg backdrop-blur-md'

interface TranscriptShareImageDialogProps {
  fileName: string
  onOpenChange: (open: boolean) => void
  open: boolean
  payload: ShareCardPayload | null
}

/**
 * Preview a branded share card and copy, download, or share the PNG.
 *
 * Frameless overlay: the poster floats on the backdrop, with separate
 * action buttons centered underneath. Capture happens in a hidden window.
 *
 * @param props.fileName Suggested PNG name for download and the macOS share sheet.
 * @param props.onOpenChange Dialog open-state callback.
 * @param props.open Whether the preview is visible.
 * @param props.payload Serializable card props sent to the hidden capture window.
 */
export function TranscriptShareImageDialog({
  fileName,
  onOpenChange,
  open,
  payload
}: TranscriptShareImageDialogProps) {
  const { t } = useTranslation()
  const blobRef = useRef<Blob | null>(null)
  const downloadButtonRef = useRef<HTMLButtonElement>(null)
  const [splitOptionsOpen, setSplitOptionsOpen] = useState(false)
  const [splitCount, setSplitCount] = useState('')
  const imageCount = splitCount === '' ? undefined : Number(splitCount)
  const isSplitCountValid =
    imageCount === undefined || (Number.isSafeInteger(imageCount) && imageCount >= 1)
  const [busy, setBusy] = useState<ShareAction | null>(null)
  const [platform, setPlatform] = useState(() =>
    MAC_SHARE_UA.test(navigator.userAgent) ? 'darwin' : ''
  )
  const canNativeShare = platform === 'darwin'
  useEffect(() => {
    if (!open) {
      blobRef.current = null
      setBusy(null)
      setSplitCount('')
      setSplitOptionsOpen(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    void ipcServices.app
      .getPlatform()
      .then((value) => {
        if (!cancelled) {
          setPlatform(value)
        }
      })
      .catch((error) => {
        logger.warn(
          `Failed to read platform for share dialog: ${error instanceof Error ? error.message : String(error)}`
        )
      })
    return () => {
      cancelled = true
    }
  }, [open])

  /**
   * Rasterize the card once in the hidden window and reuse the PNG.
   */
  const getShareBlob = async (): Promise<Blob> => {
    if (blobRef.current) {
      return blobRef.current
    }
    if (!payload) {
      throw new Error('Share card is not mounted')
    }
    const blob = await captureShareImageBlob(payload)
    blobRef.current = blob
    return blob
  }

  /**
   * Run a share action while locking the footer buttons.
   *
   * @param action Which footer button is in progress.
   * @param run Action body.
   */
  const runAction = async (action: ShareAction, run: () => Promise<void>): Promise<void> => {
    if (busy) {
      return
    }
    setBusy(action)
    try {
      await run()
    } finally {
      setBusy(null)
    }
  }

  /**
   * Copy the PNG to the clipboard.
   */
  const handleCopy = (): void => {
    void runAction('copy', async () => {
      try {
        await copyShareImageBlob(await getShareBlob())
        toast.success(t('transcript.promptShared'))
      } catch (error) {
        logger.warn(
          `Failed to copy share image: ${error instanceof Error ? error.message : String(error)}`
        )
        toast.error(t('transcript.promptShareFailed'))
      }
    })
  }

  /**
   * Save the PNG through the native save dialog.
   */
  const handleDownload = (split = false): void => {
    if (split && !isSplitCountValid) {
      return
    }
    void runAction('download', async () => {
      try {
        if (!payload) {
          throw new Error('Share card is not mounted')
        }
        const saved = split
          ? await ipcServices.fs.saveSplitShareImage({
              payload,
              defaultFileName: fileName,
              ...(imageCount === undefined ? {} : { imageCount })
            })
          : await ipcServices.fs.saveBinaryFile({
              data: await (await getShareBlob()).arrayBuffer(),
              defaultFileName: fileName
            })
        if (saved) {
          setSplitOptionsOpen(false)
          toast.success(t('transcript.promptShareSaved'))
        }
      } catch (error) {
        logger.warn(
          `Failed to save share image: ${error instanceof Error ? error.message : String(error)}`
        )
        toast.error(t('transcript.promptShareSaveFailed'))
      }
    })
  }

  /**
   * Open the macOS share sheet with the PNG.
   */
  const handleNativeShare = (): void => {
    void runAction('share', async () => {
      try {
        const blob = await getShareBlob()
        const shared = await ipcServices.fs.shareFile({
          data: await blob.arrayBuffer(),
          fileName
        })
        if (!shared) {
          toast.error(t('transcript.promptShareNativeFailed'))
        }
      } catch (error) {
        logger.warn(
          `Failed to open share sheet: ${error instanceof Error ? error.message : String(error)}`
        )
        toast.error(t('transcript.promptShareNativeFailed'))
      }
    })
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[90vh] w-auto max-w-none flex-col items-center gap-5 border-0 bg-transparent p-0 shadow-none outline-none sm:max-w-none"
        data-testid="transcript-share-image-dialog"
        showCloseButton={false}
        style={{ width: `min(${SHARE_CARD_WIDTH}px, calc(100% - 2rem))` }}
      >
        <DialogTitle className="sr-only">{t('transcript.promptShareTitle')}</DialogTitle>
        <div
          className="min-h-0 w-full overflow-auto rounded-md shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          data-testid="transcript-share-image-preview"
        >
          {payload ? <AgentResponseShareCard payload={payload} /> : null}
        </div>
        <div
          className={cn(
            'grid w-full shrink-0 gap-2',
            canNativeShare ? 'grid-cols-3' : 'grid-cols-2'
          )}
          data-testid="transcript-share-image-actions"
        >
          <Button
            className={shareActionClassName}
            data-testid="transcript-share-image-copy"
            disabled={Boolean(busy)}
            onClick={handleCopy}
            type="button"
            variant="outline"
          >
            {busy === 'copy' ? <Loader2 className="animate-spin" /> : <Copy />}
            {t('transcript.promptCopy')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className={shareActionClassName}
                data-testid="transcript-share-image-download"
                disabled={Boolean(busy)}
                ref={downloadButtonRef}
                type="button"
                variant="outline"
              >
                {busy === 'download' ? <Loader2 className="animate-spin" /> : <Download />}
                {t('transcript.promptShareDownload')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="center"
              onCloseAutoFocus={(event) => {
                if (splitOptionsOpen) {
                  event.preventDefault()
                }
              }}
              side="top"
            >
              <DropdownMenuItem disabled={Boolean(busy)} onSelect={() => handleDownload()}>
                {t('transcript.promptShareDownloadFull')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={Boolean(busy)} onSelect={() => setSplitOptionsOpen(true)}>
                {t('transcript.promptShareDownloadSplit')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canNativeShare ? (
            <Button
              className={shareActionClassName}
              data-testid="transcript-share-image-native"
              disabled={Boolean(busy)}
              onClick={handleNativeShare}
              type="button"
              variant="outline"
            >
              {busy === 'share' ? <Loader2 className="animate-spin" /> : <Share2 />}
              {t('transcript.promptShareNative')}
            </Button>
          ) : null}
        </div>
        <Dialog
          onOpenChange={(value) => {
            if (!busy) {
              setSplitOptionsOpen(value)
            }
          }}
          open={splitOptionsOpen}
        >
          <DialogContent
            className="gap-6 sm:max-w-sm"
            data-testid="share-split-options"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              downloadButtonRef.current?.focus()
            }}
            showCloseButton={!busy}
          >
            <DialogHeader>
              <DialogTitle>{t('transcript.promptShareDownloadSplit')}</DialogTitle>
              <DialogDescription>{t('transcript.promptShareSplitCountHint')}</DialogDescription>
            </DialogHeader>
            <form
              className="space-y-6"
              onSubmit={(event) => {
                event.preventDefault()
                handleDownload(true)
              }}
            >
              <div className="space-y-2">
                <label className="font-medium text-sm" htmlFor="share-image-count">
                  {t('transcript.promptShareSplitCount')}
                </label>
                <Input
                  aria-invalid={!isSplitCountValid}
                  disabled={Boolean(busy)}
                  id="share-image-count"
                  min={1}
                  onChange={(event) => setSplitCount(event.target.value)}
                  placeholder={t('transcript.promptShareSplitCountAuto')}
                  step={1}
                  type="number"
                  value={splitCount}
                />
              </div>
              <DialogFooter>
                <Button
                  disabled={Boolean(busy)}
                  onClick={() => setSplitOptionsOpen(false)}
                  type="button"
                  variant="outline"
                >
                  {t('download.cancel')}
                </Button>
                <Button
                  data-testid="share-split-confirm"
                  disabled={Boolean(busy) || !isSplitCountValid}
                  type="submit"
                >
                  {busy === 'download' ? <Loader2 className="animate-spin" /> : <Download />}
                  {t('transcript.promptShareDownload')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
