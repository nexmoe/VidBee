import { AsrModelRow } from '@renderer/components/settings/asr-model-row'
import {
  type AsrModelStatusView,
  displayGpuName,
  formatRam,
  toModelStatusView
} from '@renderer/components/settings/asr-model-shared'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { ItemGroup } from '@renderer/components/ui/item'
import { ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import type { TranscriptSnapshotView } from '@renderer/store/transcripts'
import { languageList, normalizeLanguageCode } from '@vidbee/i18n/languages'
import { type AsrTierId, parseAsrTier, upgradeAsrTiers } from '@vidbee/transcription/asr'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/**
 * Upgrade picker that reuses the settings model row and machine recommendation.
 */
export function AsrUpgradeDialog({
  currentTier,
  downloadId,
  onOpenChange,
  onUpgraded,
  open
}: {
  currentTier: AsrTierId | string | null | undefined
  downloadId: string
  onOpenChange: (open: boolean) => void
  onUpgraded: (snapshot: TranscriptSnapshotView) => void
  open: boolean
}) {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState<AsrModelStatusView | null>(null)
  const [busyTier, setBusyTier] = useState<AsrTierId | null>(null)
  const activeTier = parseAsrTier(currentTier)
  const refresh = useCallback(async () => {
    try {
      setStatus(toModelStatusView(await ipcServices.transcript.getModelStatus()))
    } catch (error) {
      logger.error('Failed to load transcription model status', error)
      setStatus(
        (prev) =>
          prev ?? {
            bytes: 0,
            downloads: [],
            pendingTiers: [],
            ready: false,
            recommended: [],
            tiers: []
          }
      )
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setBusyTier(null)
      return
    }
    void refresh()
    const timer = window.setInterval(
      () => {
        void refresh()
      },
      busyTier ? 400 : 1500
    )
    return () => {
      window.clearInterval(timer)
    }
  }, [busyTier, open, refresh])

  const upgradeOptions = useMemo(
    () => (status ? upgradeAsrTiers(activeTier, status.recommended) : null),
    [activeTier, status]
  )
  const showMax = upgradeOptions !== null && upgradeOptions.length === 0

  /**
   * Download a higher model if needed, then start a new transcript.
   */
  const handleSelect = async (tier: AsrTierId) => {
    setBusyTier(tier)
    try {
      const next = await ipcServices.transcript.upgrade({ downloadId, tier })
      onUpgraded(next as TranscriptSnapshotView)
      onOpenChange(false)
    } catch (error) {
      logger.error('Failed to upgrade transcript model', error)
      toast.error(error instanceof Error ? error.message : t('transcript.retryFailed'))
    } finally {
      setBusyTier(null)
    }
  }

  const languageName =
    languageList.find(
      (option) => option.value === normalizeLanguageCode(status?.language ?? i18n.language)
    )?.name ?? t('settings.asrLanguages.multi')

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('transcript.qualityHint')}</DialogTitle>
          <DialogDescription>
            {showMax ? t('transcript.qualityHintMax') : t('transcript.qualityHintDetail')}
          </DialogDescription>
        </DialogHeader>
        {upgradeOptions && upgradeOptions.length > 0 ? (
          <div className="space-y-3">
            {status?.machine ? (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t('settings.asrRecommendedFor', {
                  ram: formatRam(status.machine.ramBytes),
                  cores: status.machine.cpuCount,
                  language: languageName,
                  os: t(`settings.asrOs.${status.machine.os ?? 'other'}`),
                  gpu: displayGpuName(status.machine.gpuName, status.machine.gpu, (kind) =>
                    t(`settings.asrGpu.${kind}`)
                  )
                })}
              </p>
            ) : null}
            <ItemGroup>
              {upgradeOptions.map((tier, index) => (
                <AsrModelRow
                  activeTier={activeTier}
                  busy={busyTier === tier.id}
                  disabled={busyTier != null && busyTier !== tier.id}
                  downloading={status?.downloads.find((item) => item.tier === tier.id) ?? null}
                  key={tier.id}
                  onSelect={(id) => void handleSelect(id)}
                  recommended={status?.recommended.includes(tier.id) ?? false}
                  showSeparator={index > 0}
                  status={status?.tiers.find((item) => item.id === tier.id)}
                  tier={tier.id}
                />
              ))}
            </ItemGroup>
          </div>
        ) : null}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="ghost">
            {t('transcript.export.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
