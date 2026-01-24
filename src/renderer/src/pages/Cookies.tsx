import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { RemoteImage } from '@renderer/components/ui/remote-image'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { ipcServices } from '@renderer/lib/ipc'
import type { SyncedCookiesSnapshot } from '@shared/types'
import dayjs from 'dayjs'
import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const formatTimestamp = (value?: number) => {
  if (!value) return '-'
  return dayjs(value).format('YYYY-MM-DD HH:mm')
}

const extractMainDomain = (domain: string): string => {
  if (!domain) return ''

  // Remove leading dot
  domain = domain.replace(/^\./, '')

  // Split by dots
  const parts = domain.split('.')

  // Handle IP addresses
  if (/^\d+$/.test(parts[parts.length - 1])) {
    return domain
  }

  // Return the last two parts (e.g., example.com from www.example.com)
  if (parts.length > 2) {
    return parts.slice(-2).join('.')
  }

  return domain
}

export function Cookies() {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<SyncedCookiesSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadEntries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await ipcServices.syncedCookies.list()
      setSnapshot(list[0] ?? null)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('cookiesPage.error')
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  const sites = useMemo(() => {
    if (!snapshot) return []
    const counts = new Map<string, number>()
    for (const cookie of snapshot.cookies) {
      const domain = extractMainDomain(cookie.domain ?? '') || t('cookiesPage.unknownSite')
      counts.set(domain, (counts.get(domain) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => a.domain.localeCompare(b.domain))
  }, [snapshot, t])

  const isEmpty = !loading && !error && (!snapshot || sites.length === 0)
  const lastSyncedLabel = t('cookiesPage.lastSyncedAt', {
    time: formatTimestamp(snapshot?.createdAt)
  })

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('cookiesPage.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('cookiesPage.description')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{lastSyncedLabel}</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadEntries} disabled={loading}>
          <RefreshCw className="h-4 w-4" />
          <span className="ml-2">{t('cookiesPage.actions.refresh')}</span>
        </Button>
      </div>

      <div className="flex-1">
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-base">{t('cookiesPage.entriesTitle')}</CardTitle>
            <CardDescription>{t('cookiesPage.entriesDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="h-[520px] p-0">
            <ScrollArea className="h-full px-4 pb-4">
              {loading && (
                <div className="py-6 text-sm text-muted-foreground">{t('cookiesPage.loading')}</div>
              )}
              {error && <div className="py-6 text-sm text-red-500">{error}</div>}
              {isEmpty && (
                <div className="py-6 text-sm text-muted-foreground">{t('cookiesPage.empty')}</div>
              )}
              {!loading &&
                !error &&
                sites.map((site) => (
                  <div
                    key={site.domain}
                    className="mb-3 flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-3"
                  >
                    <RemoteImage
                      src={`https://unavatar.io/${site.domain}`}
                      alt={site.domain}
                      className="h-8 w-8 flex-shrink-0 rounded-md"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{site.domain}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t('cookiesPage.labels.cookies')}: {site.count}
                      </div>
                    </div>
                  </div>
                ))}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
