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
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState(connection)
  const [saving, setSaving] = useState(false)

  useEffect(() => setSnapshot(connection), [connection])

  /** Move one profile without changing the order of other connected or offline profiles. */
  const moveSource = async (index: number, destination: number): Promise<void> => {
    const sources = [...(snapshot.sources ?? [])]
    const [source] = sources.splice(index, 1)
    if (!source || saving) {
      return
    }
    sources.splice(destination, 0, source)
    setSaving(true)
    try {
      setSnapshot(
        await ipcServices.browserCookies.setExtensionSourceOrder(sources.map((item) => item.id))
      )
      onOrderChange()
    } catch (error) {
      logger.error('[CookiesSetup] Failed to reorder extension sources', { error })
      toast.error(t('settings.saveError'))
    } finally {
      setSaving(false)
    }
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
          const browser = t(`settings.browserOptions.${source.browser}`)
          const active = snapshot.activeSourceId === source.id
          return (
            <li className="flex flex-wrap items-center gap-2 rounded-md py-1" key={source.id}>
              <span className="w-5 text-center text-muted-foreground text-xs">{index + 1}</span>
              <span
                className={
                  source.connected
                    ? 'min-w-0 flex-1 text-sm'
                    : 'min-w-0 flex-1 text-muted-foreground text-sm opacity-60'
                }
              >
                {browser}
              </span>
              <Badge variant={active ? 'secondary' : 'outline'}>
                {active
                  ? t('settings.cookiesSetup.sourceInUse')
                  : t(
                      source.connected
                        ? 'settings.cookiesSetup.sourceFallback'
                        : 'settings.cookiesSetup.extensionDisconnected'
                    )}
              </Badge>
              {active ? null : (
                <Button
                  aria-label={t('settings.cookiesSetup.useThisBrowser', { browser })}
                  disabled={!source.connected || saving}
                  onClick={() => void moveSource(index, 0)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t('settings.cookiesSetup.extensionUse')}
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
