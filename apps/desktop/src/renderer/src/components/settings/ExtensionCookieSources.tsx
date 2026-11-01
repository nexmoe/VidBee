import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import type { ExtensionCookieConnection } from '@shared/extension-cookies'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface ExtensionCookieSourcesProps {
  connection: ExtensionCookieConnection
  onOrderChange: () => void
}

/** Show remembered browser profiles and persist their cookie fallback order. */
export function ExtensionCookieSources({ connection, onOrderChange }: ExtensionCookieSourcesProps) {
  const { t, i18n } = useTranslation()
  const [snapshot, setSnapshot] = useState(connection)
  const [saving, setSaving] = useState(false)

  useEffect(() => setSnapshot(connection), [connection])

  /** Save a source change and refresh every consumer of the shared connection state. */
  const updateSources = async (update: () => Promise<ExtensionCookieConnection>): Promise<void> => {
    if (saving) {
      return
    }
    setSaving(true)
    try {
      setSnapshot(await update())
      onOrderChange()
    } catch (error) {
      logger.error('[CookiesSetup] Failed to update extension sources', { error })
      toast.error(t('settings.saveError'))
    } finally {
      setSaving(false)
    }
  }

  /** Move one profile without changing the order of the other sources. */
  const moveSource = async (index: number, destination: number): Promise<void> => {
    const sources = [...(snapshot.sources ?? [])]
    const [source] = sources.splice(index, 1)
    if (!source) {
      return
    }
    sources.splice(destination, 0, source)
    await updateSources(() =>
      ipcServices.browserCookies.setExtensionSourceOrder(sources.map((item) => item.id))
    )
  }

  /** Forget an offline source; the main process rejects sources that have reconnected. */
  const removeSource = async (id: string): Promise<void> => {
    await updateSources(() => ipcServices.browserCookies.removeExtensionSource(id))
  }

  if (!snapshot.sources?.length) {
    return null
  }

  return (
    <div className="basis-full space-y-2 border-t pt-3">
      <p className="text-muted-foreground text-sm">
        {t('settings.cookiesSetup.extensionPriorityHint')}
      </p>
      <ol
        aria-label={t('settings.cookiesSetup.extensionPriority')}
        className="space-y-1 rounded-lg bg-background/70 p-2"
      >
        {snapshot.sources.map((source, index) => {
          const duplicate = snapshot.sources.some(
            (item) =>
              item.id !== source.id &&
              item.browser === source.browser &&
              item.variant === source.variant &&
              !!item.legacy === !!source.legacy
          )
          const browser = [
            t(`settings.browserOptions.${source.browser}`),
            source.variant && t(`settings.cookiesSetup.extensionVariants.${source.variant}`),
            source.legacy && t('settings.cookiesSetup.extensionLegacy'),
            (!source.variant || duplicate) && `#${source.id.slice(0, 8)}`
          ]
            .filter(Boolean)
            .join(' · ')
          const active = snapshot.activeSourceId === source.id
          return (
            <li className="flex flex-wrap items-center gap-2 rounded-md py-1" key={source.id}>
              <span className="w-5 text-center text-muted-foreground text-xs">{index + 1}</span>
              <div
                className={
                  source.connected
                    ? 'min-w-0 flex-1 text-sm'
                    : 'min-w-0 flex-1 text-muted-foreground text-sm opacity-60'
                }
              >
                <p>{browser}</p>
                <p className="text-muted-foreground text-xs">
                  {source.lastConnectedAt ? (
                    <time dateTime={new Date(source.lastConnectedAt).toISOString()}>
                      {t('settings.cookiesSetup.extensionLastConnected', {
                        time: new Date(source.lastConnectedAt).toLocaleString(
                          i18n.resolvedLanguage ?? i18n.language,
                          { dateStyle: 'medium', timeStyle: 'short' }
                        )
                      })}
                    </time>
                  ) : (
                    t('settings.cookiesSetup.extensionLastConnectedUnknown')
                  )}
                </p>
              </div>
              <Badge variant={active ? 'secondary' : 'outline'}>
                {active
                  ? t('settings.cookiesSetup.sourceInUse')
                  : t(
                      source.connected
                        ? 'settings.cookiesSetup.sourceFallback'
                        : 'settings.cookiesSetup.extensionDisconnected'
                    )}
              </Badge>
              {source.connected ? (
                active ? null : (
                  <Button
                    aria-label={t('settings.cookiesSetup.useThisBrowser', { browser })}
                    disabled={saving}
                    onClick={() => void moveSource(index, 0)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {t('settings.cookiesSetup.extensionUse')}
                  </Button>
                )
              ) : (
                <Button
                  aria-label={t('settings.cookiesSetup.extensionRemoveLabel', { browser })}
                  disabled={saving}
                  onClick={() => void removeSource(source.id)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t('settings.cookiesSetup.extensionRemove')}
                </Button>
              )}
              <div className="flex items-center">
                <Button
                  aria-label={t('settings.cookiesSetup.extensionMoveUp', { browser })}
                  className="size-7"
                  disabled={saving || index === 0}
                  onClick={() => void moveSource(index, index - 1)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <ArrowUp aria-hidden className="size-4" />
                </Button>
                <Button
                  aria-label={t('settings.cookiesSetup.extensionMoveDown', { browser })}
                  className="size-7"
                  disabled={saving || index === snapshot.sources.length - 1}
                  onClick={() => void moveSource(index, index + 1)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <ArrowDown aria-hidden className="size-4" />
                </Button>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
