import { Button } from '@renderer/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@renderer/components/ui/item'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useCloudAccount } from '@renderer/hooks/use-cloud-account'
import { ipcServices } from '@renderer/lib/ipc'
import type { AppSettings } from '@shared/types'
import type { CloudTranscriptionCatalog } from '@vidbee/transcription/cloud'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/** Configure paid Cloud recognition alongside the free local transcription option. */
export function CloudTranscriptionSettings({
  settings,
  onChange,
  onOpenAccount
}: {
  settings: AppSettings
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void | Promise<void>
  onOpenAccount: () => void
}) {
  const { t, i18n } = useTranslation()
  const { user, credits, loading } = useCloudAccount()
  const [catalog, setCatalog] = useState<CloudTranscriptionCatalog | null>(null)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter explicitly refreshes the remote catalog.
  useEffect(() => {
    let active = true
    setCatalog(null)
    setError(false)
    if (user) {
      void ipcServices.transcript
        .getCloudModels()
        .then((value) => {
          if (active) {
            setCatalog(value)
          }
        })
        .catch(() => {
          if (active) {
            setError(true)
          }
        })
    }
    return () => {
      active = false
    }
  }, [user, refresh])
  const model = catalog?.models.find((item) => item.id === settings.cloudTranscriptionModelId)
  const number = new Intl.NumberFormat(i18n.language)
  /** Report sign-in failures through the existing account feedback UI. */
  const signIn = async (): Promise<void> => {
    try {
      await window.requestAuth()
    } catch {
      toast.error(t('settings.account.error'))
    }
  }
  return (
    <ItemGroup>
      <Item variant="muted">
        <ItemContent>
          <ItemTitle>{t('settings.cloudTranscription.title')}</ItemTitle>
          <ItemDescription>{t('settings.cloudTranscription.description')}</ItemDescription>
          <ItemDescription>{t('settings.cloudTranscription.billing')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Select
            onValueChange={(value) =>
              void onChange('transcriptionProvider', value === 'cloud' ? 'cloud' : 'local')
            }
            value={settings.transcriptionProvider}
          >
            <SelectTrigger aria-label={t('settings.cloudTranscription.provider')} className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">{t('settings.cloudTranscription.local')}</SelectItem>
              <SelectItem value="cloud">{t('settings.cloudTranscription.cloud')}</SelectItem>
            </SelectContent>
          </Select>
        </ItemActions>
      </Item>
      {settings.transcriptionProvider === 'cloud' ? (
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{model?.name ?? t('settings.cloudTranscription.cloud')}</ItemTitle>
            <ItemDescription>
              {model
                ? t('settings.cloudTranscription.price', {
                    credits: number.format(model.creditsPerSecond * 60)
                  })
                : t(user ? 'download.loading' : 'settings.cloudTranscription.signInDescription')}
            </ItemDescription>
            {user && credits ? (
              <ItemDescription>
                {t('settings.cloudTranscription.balance', {
                  credits: number.format(credits.remainingCredits)
                })}
              </ItemDescription>
            ) : null}
            <ItemDescription>{t('settings.cloudTranscription.automatic')}</ItemDescription>
            <ItemDescription>{t('settings.cloudTranscription.timing')}</ItemDescription>
            {error ? (
              <ItemDescription>{t('settings.cloudTranscription.unavailable')}</ItemDescription>
            ) : null}
            {catalog && !model ? (
              <ItemDescription>{t('settings.cloudTranscription.modelUnavailable')}</ItemDescription>
            ) : null}
          </ItemContent>
          <ItemActions>
            {user ? null : (
              <Button disabled={loading} onClick={() => void signIn()} size="sm" variant="outline">
                {t('settings.account.signIn')}
              </Button>
            )}
            {user ? (
              <Button onClick={onOpenAccount} size="sm" variant="outline">
                {t('settings.account.creditsTopUp')}
              </Button>
            ) : null}
            {catalog ? (
              <Select
                onValueChange={(value) => void onChange('cloudTranscriptionModelId', value)}
                value={settings.cloudTranscriptionModelId}
              >
                <SelectTrigger aria-label={t('settings.cloudTranscription.model')} className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {catalog.models.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {error ? (
              <Button onClick={() => setRefresh((value) => value + 1)} size="sm" variant="outline">
                {t('transcript.retry')}
              </Button>
            ) : null}
          </ItemActions>
        </Item>
      ) : null}
    </ItemGroup>
  )
}
