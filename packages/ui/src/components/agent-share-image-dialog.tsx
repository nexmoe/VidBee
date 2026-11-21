import { Copy, Download, Loader2, Share2 } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Input } from './ui/input'

type ShareAction = 'copy' | 'download' | 'share'

/** Standalone pill chrome for each share-dialog action. */
const shareActionClassName =
  'h-10 w-full min-w-0 rounded-full border-border/70 bg-background/95 px-5 shadow-lg backdrop-blur-md'

export interface AgentShareImageDialogProps {
  fileName: string
  identity: unknown
  onOpenChange: (open: boolean) => void
  open: boolean
  preview: ReactNode
  captureImage: () => Promise<Blob>
  copyImage: (blob: Blob) => Promise<void>
  saveImage: (options: { split: boolean; imageCount?: number; blob?: Blob }) => Promise<boolean>
  onNativeShare?: (blob: Blob, fileName: string) => Promise<boolean>
  onNotice: (key: string, error?: boolean) => void
  t: (key: string) => string
}

/** Shared share-image preview, copy, full download and pagination controls. */
export function AgentShareImageDialog({
  fileName,
  identity,
  onOpenChange,
  open,
  preview,
  captureImage,
  copyImage,
  saveImage,
  onNativeShare,
  onNotice,
  t
}: AgentShareImageDialogProps) {
  const blobRef = useRef<Blob | null>(null)
  const downloadButtonRef = useRef<HTMLButtonElement>(null)
  const [splitOptionsOpen, setSplitOptionsOpen] = useState(false)
  const [splitCount, setSplitCount] = useState('')
  const imageCount = splitCount === '' ? undefined : Number(splitCount)
  const isSplitCountValid =
    imageCount === undefined || (Number.isSafeInteger(imageCount) && imageCount >= 1)
  const [busy, setBusy] = useState<ShareAction | null>(null)
  const canNativeShare = Boolean(onNativeShare)
  const previous = useRef({ open, identity })
  useEffect(() => {
    if (previous.current.open === open && previous.current.identity === identity) {
      return
    }
    previous.current = { open, identity }
    blobRef.current = null
    setBusy(null)
    setSplitCount('')
    setSplitOptionsOpen(false)
  }, [open, identity])

  /**
   * Rasterize the card once in the hidden window and reuse the PNG.
   */
  const getShareBlob = async (): Promise<Blob> => {
    if (blobRef.current) {
      return blobRef.current
    }
    const blob = await captureImage()
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
        await copyImage(await getShareBlob())
        onNotice('transcript.promptShared')
      } catch {
        onNotice('transcript.promptShareFailed', true)
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
        const saved = await saveImage({
          split,
          imageCount,
          blob: split ? undefined : await getShareBlob()
        })
        if (saved) {
          setSplitOptionsOpen(false)
          onNotice('transcript.promptShareSaved')
        }
      } catch {
        onNotice('transcript.promptShareSaveFailed', true)
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
        const shared = await onNativeShare?.(blob, fileName)
        if (!shared) {
          onNotice('transcript.promptShareNativeFailed', true)
        }
      } catch {
        onNotice('transcript.promptShareNativeFailed', true)
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
        style={{ width: 'min(540px, calc(100% - 2rem))' }}
      >
        <DialogTitle className="sr-only">{t('transcript.promptShareTitle')}</DialogTitle>
        <div
          className="min-h-0 w-full overflow-auto rounded-md shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          data-testid="transcript-share-image-preview"
        >
          {preview}
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
