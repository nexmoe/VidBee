import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle
} from '@renderer/components/ui/item'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import { languageList, normalizeLanguageCode } from '@vidbee/i18n/languages'
import { ASR_FAMILY_ORDER, ASR_TIERS, type AsrTierId } from '@vidbee/transcription/asr'
import {
  CONCURRENT_TRANSCRIPTION_CHOICES,
  clampMaxConcurrentTranscriptions
} from '@vidbee/transcription/concurrency'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AsrModelRow } from './asr-model-row'
import {
  type AsrModelStatusView,
  displayGpuName,
  formatBytes,
  formatRam,
  isCancelledDownload,
  toModelStatusView
} from './asr-model-shared'

/**
 * AI settings card: auto-transcribe toggle, concurrency, model status, then the model list.
 */
export const AsrModelPicker = ({
  activeTier,
  autoTranscribe,
  concurrency,
  onChangeConcurrency,
  onSelectTier,
  onToggleAutoTranscribe
}: {
  activeTier: AsrTierId
  autoTranscribe?: boolean
  concurrency?: number
  onChangeConcurrency?: (value: number) => void
  onSelectTier: (tier: AsrTierId) => Promise<void> | void
  onToggleAutoTranscribe?: () => void
}) => {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState<AsrModelStatusView | null>(null)
  const [busyTiers, setBusyTiers] = useState<ReadonlySet<AsrTierId>>(() => new Set())
  const downloadingCount = busyTiers.size + (status?.pendingTiers.length ?? 0)
  const refresh = useCallback(async () => {
    try {
      setStatus(toModelStatusView(await ipcServices.transcript.getModelStatus()))
    } catch (error) {
      logger.error('Failed to load transcription model status', error)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(
      () => {
        void refresh()
      },
      downloadingCount > 0 ? 400 : 1500
    )
    return () => {
      window.clearInterval(timer)
    }
  }, [downloadingCount, refresh])

  /**
   * Mark a model as busy so its row can show a ring without blocking others.
   */
  const markBusy = (tier: AsrTierId, busy: boolean) => {
    setBusyTiers((prev) => {
      const next = new Set(prev)
      if (busy) {
        next.add(tier)
      } else {
        next.delete(tier)
      }
      return next
    })
  }

  /**
   * Download a missing model if needed, then make it the active default.
   */
  const handleSelect = async (tier: AsrTierId) => {
    const ready = status?.tiers.find((item) => item.id === tier)?.ready === true
    markBusy(tier, true)
    try {
      await ipcServices.transcript.setTier(tier)
      await onSelectTier(tier)
      await refresh()
    } catch (error) {
      if (!ready && isCancelledDownload(error)) {
        logger.info('ASR model download cancelled', { tier })
        await refresh()
        return
      }
      logger.error('Failed to download and use ASR tier', error)
      toast.error(t(ready ? 'settings.asrTierActivateError' : 'settings.asrDownloadError'))
    } finally {
      markBusy(tier, false)
    }
  }

  /**
   * Abort an in-progress model download.
   */
  const handleCancel = async (tier: AsrTierId) => {
    try {
      await ipcServices.transcript.cancelTier(tier)
      await refresh()
    } catch (error) {
      logger.error('Failed to cancel ASR download', error)
      toast.error(t('settings.asrCancelError'))
    }
  }

  /**
   * Remove a downloaded model that is not currently in use.
   */
  const handleDelete = async (tier: AsrTierId) => {
    markBusy(tier, true)
    try {
      await ipcServices.transcript.deleteTier(tier)
      await refresh()
    } catch (error) {
      logger.error('Failed to delete ASR tier', error)
      toast.error(t('settings.asrDeleteError'))
    } finally {
      markBusy(tier, false)
    }
  }

  const recommendedIds = status?.recommended ?? []
  const downloaded = useMemo(() => {
    const readyIds = new Set(
      (status?.tiers ?? []).filter((tier) => tier.ready).map((tier) => tier.id)
    )
    if (readyIds.has(activeTier)) {
      return [
        activeTier,
        ...ASR_TIERS.map((tier) => tier.id).filter((id) => id !== activeTier && readyIds.has(id))
      ]
    }
    return ASR_TIERS.map((tier) => tier.id).filter((id) => readyIds.has(id))
  }, [activeTier, status?.tiers])

  const languageName =
    languageList.find(
      (option) => option.value === normalizeLanguageCode(status?.language ?? i18n.language)
    )?.name ?? t('settings.asrLanguages.multi')

  return (
    <>
      <ItemGroup>
        {onToggleAutoTranscribe == null ? null : (
          <>
            <Item variant="muted">
              <ItemContent>
                <ItemTitle>{t('settings.autoTranscribeAfterDownload')}</ItemTitle>
                <ItemDescription>
                  {t('settings.autoTranscribeAfterDownloadDescription')}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Switch
                  checked={autoTranscribe ?? true}
                  label=""
                  onToggle={onToggleAutoTranscribe}
                />
              </ItemActions>
            </Item>
            <ItemSeparator />
          </>
        )}
        {onChangeConcurrency == null ? null : (
          <>
            <Item variant="muted">
              <ItemContent>
                <ItemTitle>{t('settings.maxConcurrentTranscriptions')}</ItemTitle>
                <ItemDescription>
                  {t('settings.maxConcurrentTranscriptionsDescription')}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Select
                  onValueChange={(value) => {
                    onChangeConcurrency(clampMaxConcurrentTranscriptions(Number(value)))
                  }}
                  value={clampMaxConcurrentTranscriptions(concurrency).toString()}
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONCURRENT_TRANSCRIPTION_CHOICES.map((num) => (
                      <SelectItem key={num} value={num.toString()}>
                        {num}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ItemActions>
            </Item>
            <ItemSeparator />
          </>
        )}
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{t('settings.transcriptModelsTitle')}</ItemTitle>
            <ItemDescription>
              {status?.ready
                ? t('settings.transcriptModelsReady', { size: formatBytes(status.bytes) })
                : t('settings.transcriptModelsMissing')}
              {status && status.downloads.length > 1
                ? ` ${t('settings.asrDownloadingMany', { count: status.downloads.length })}`
                : status?.downloads[0]
                  ? ` ${t('settings.asrDownloading', {
                      received: formatBytes(status.downloads[0].received),
                      total: status.downloads[0].total
                        ? formatBytes(status.downloads[0].total)
                        : '—'
                    })}`
                  : null}
            </ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>

      {downloaded.length > 0 ? (
        <div className="space-y-2">
          <h3 className="px-1 font-medium text-muted-foreground text-sm">
            {t('settings.asrDownloaded')}
          </h3>
          <ItemGroup>
            {downloaded.map((tier, index) => (
              <AsrModelRow
                activeTier={activeTier}
                busy={busyTiers.has(tier) || status?.pendingTiers.includes(tier) === true}
                downloading={status?.downloads.find((item) => item.tier === tier) ?? null}
                key={`downloaded-${tier}`}
                onCancel={(id) => void handleCancel(id)}
                onDelete={(id) => void handleDelete(id)}
                onSelect={(id) => void handleSelect(id)}
                recommended={recommendedIds.includes(tier)}
                showSeparator={index > 0}
                status={status?.tiers.find((item) => item.id === tier)}
                tier={tier}
              />
            ))}
          </ItemGroup>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="space-y-1 px-1">
          <h3 className="font-medium text-muted-foreground text-sm">
            {t('settings.asrRecommended')}
          </h3>
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
        </div>
        <ItemGroup>
          {(recommendedIds.length > 0 ? recommendedIds : (['minimal'] as AsrTierId[])).map(
            (tier, index) => (
              <AsrModelRow
                activeTier={activeTier}
                busy={busyTiers.has(tier) || status?.pendingTiers.includes(tier) === true}
                downloading={status?.downloads.find((item) => item.tier === tier) ?? null}
                key={`recommended-${tier}`}
                onCancel={(id) => void handleCancel(id)}
                onSelect={(id) => void handleSelect(id)}
                recommended
                showSeparator={index > 0}
                status={status?.tiers.find((item) => item.id === tier)}
                tier={tier}
              />
            )
          )}
        </ItemGroup>
      </div>

      <div className="space-y-3">
        <h3 className="px-1 font-medium text-muted-foreground text-sm">
          {t('settings.asrAllModels')}
        </h3>
        {ASR_FAMILY_ORDER.map((family) => {
          const models = ASR_TIERS.filter((tier) => tier.family === family)
          if (models.length === 0) {
            return null
          }
          return (
            <div className="space-y-2" key={family}>
              <p className="px-1 text-muted-foreground text-xs">
                {t(`settings.asrFamily.${family}`)}
              </p>
              <ItemGroup>
                {models.map((tier, index) => (
                  <AsrModelRow
                    activeTier={activeTier}
                    busy={busyTiers.has(tier.id) || status?.pendingTiers.includes(tier.id) === true}
                    downloading={status?.downloads.find((item) => item.tier === tier.id) ?? null}
                    key={`all-${tier.id}`}
                    onCancel={(id) => void handleCancel(id)}
                    onSelect={(id) => void handleSelect(id)}
                    recommended={recommendedIds.includes(tier.id)}
                    showSeparator={index > 0}
                    status={status?.tiers.find((item) => item.id === tier.id)}
                    tier={tier.id}
                  />
                ))}
              </ItemGroup>
            </div>
          )
        })}
      </div>
    </>
  )
}
