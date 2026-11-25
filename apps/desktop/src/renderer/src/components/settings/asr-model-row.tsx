import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemSeparator,
  ItemTitle
} from '@renderer/components/ui/item'
import { type AsrTierId, asrTierInfo } from '@vidbee/transcription/asr'
import { Check, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AsrFamilyIcon } from './asr-family-icon'
import { type AsrDownloadView, type AsrTierRow, formatBytes } from './asr-model-shared'

/**
 * Small ring that fills as a model archive downloads.
 */
export const AsrDownloadRing = ({
  label,
  received,
  total
}: {
  label: string
  received: number
  total: number | null
}) => {
  const size = 20
  const stroke = 2
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const known = total != null && total > 0
  const ratio = known ? Math.min(1, Math.max(0, received / total)) : 0.22
  return (
    <span
      aria-label={label}
      aria-valuemax={known ? 100 : undefined}
      aria-valuemin={known ? 0 : undefined}
      aria-valuenow={known ? Math.round(ratio * 100) : undefined}
      className="inline-flex size-5 items-center justify-center"
      role="progressbar"
    >
      <svg
        className={known ? undefined : 'animate-spin motion-reduce:animate-none'}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        width={size}
      >
        <title>{label}</title>
        <circle
          className="text-muted-foreground/25"
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          stroke="currentColor"
          strokeWidth={stroke}
        />
        <circle
          className="text-primary"
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          strokeLinecap="round"
          strokeWidth={stroke}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
    </span>
  )
}

/**
 * Render one ASR model row with status, tags, and the use/download action.
 */
export const AsrModelRow = ({
  activeTier,
  busy,
  disabled,
  downloading,
  onCancel,
  onDelete,
  onSelect,
  recommended,
  showSeparator,
  status,
  tier
}: {
  activeTier: AsrTierId
  busy: boolean
  disabled?: boolean
  downloading: AsrDownloadView | null
  onCancel?: (tier: AsrTierId) => void
  onDelete?: (tier: AsrTierId) => void
  onSelect: (tier: AsrTierId) => void
  recommended: boolean
  showSeparator: boolean
  status: AsrTierRow | undefined
  tier: AsrTierId
}) => {
  const { t } = useTranslation()
  const info = asrTierInfo(tier)
  const isActive = activeTier === tier
  const ready = status?.ready === true
  const showRing = busy && !ready
  const state = ready
    ? isActive
      ? t('settings.asrStatusActive')
      : t('settings.asrStatusReady')
    : showRing
      ? t('settings.asrStatusDownloading')
      : t('settings.asrStatusMissing')
  const actionLabel = isActive
    ? t('settings.asrUseCurrent')
    : ready
      ? t('settings.asrUse')
      : t('settings.asrDownloadAndUse')
  return (
    <>
      {showSeparator ? <ItemSeparator /> : null}
      <Item variant="muted">
        <ItemMedia className="border-border bg-background" variant="icon">
          <AsrFamilyIcon family={info.family} />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            {t(`settings.asrTier.${tier}.title`)}
            {isActive ? (
              <Badge variant="secondary">
                <Check aria-hidden className="size-3" />
                {t('settings.asrStatusActive')}
              </Badge>
            ) : null}
            {recommended && !isActive ? (
              <Badge variant="outline">{t('settings.asrBestMatch')}</Badge>
            ) : null}
          </ItemTitle>
          <ItemDescription className="line-clamp-none">
            {t(`settings.asrTier.${tier}.tag`)} · {t(`settings.asrTier.${tier}.size`)} · {state}
            {status?.bytes ? ` (${formatBytes(status.bytes)})` : ''}
            {tier === 'fourier-en' ? (
              <>
                {' · '}
                <a
                  className="underline"
                  href="https://huggingface.co/oruk/oruk-fourier-2b"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  oruk/oruk-fourier-2b
                </a>
              </>
            ) : null}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          {onDelete && ready && !isActive ? (
            <Button
              aria-label={t('settings.asrDelete')}
              className="size-8"
              disabled={busy || disabled}
              onClick={() => onDelete(tier)}
              size="icon"
              title={t('settings.asrDelete')}
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
          {showRing ? (
            <div className="flex items-center gap-2">
              <AsrDownloadRing
                label={t('settings.asrStatusDownloading')}
                received={downloading?.received ?? 0}
                total={downloading?.total ?? null}
              />
              {onCancel ? (
                <Button onClick={() => onCancel(tier)} size="sm" type="button" variant="outline">
                  {t('settings.asrCancel')}
                </Button>
              ) : null}
            </div>
          ) : (
            <Button
              disabled={isActive || busy || disabled}
              onClick={() => onSelect(tier)}
              size="sm"
              variant={isActive ? 'default' : 'outline'}
            >
              {actionLabel}
            </Button>
          )}
        </ItemActions>
      </Item>
    </>
  )
}
