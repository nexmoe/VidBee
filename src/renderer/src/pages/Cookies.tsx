import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { RemoteImage } from '@renderer/components/ui/remote-image'
import { ipcServices } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import type { SyncedCookiesSnapshot } from '@shared/types'
import dayjs from 'dayjs'
import { FileUp, Gem, Lock, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

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

  const handleImportCookies = useCallback(async () => {
    setImporting(true)
    try {
      const result = await ipcServices.syncedCookies.import()
      if (result) {
        toast.success(t('cookiesPage.import.success'), {
          description: t('cookiesPage.import.successDescription', { count: result.cookieCount })
        })
        setSnapshot(result)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('cookiesPage.import.error')
      toast.error(t('cookiesPage.import.error'), {
        description: message
      })
    } finally {
      setImporting(false)
    }
  }, [t])

  const handleClearCookies = useCallback(() => {
    setShowClearConfirm(true)
  }, [])

  const handleConfirmClear = useCallback(async () => {
    try {
      await ipcServices.syncedCookies.clear()
      toast.success(t('cookiesPage.clear.success'))
      setSnapshot(null)
      setShowClearConfirm(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('cookiesPage.clear.error')
      toast.error(t('cookiesPage.clear.error'), {
        description: message
      })
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

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* 1. Alignment with Home Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-border/40 z-50 bg-background/80 backdrop-blur sticky top-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground/80 leading-none">
            {t('cookiesPage.title')}
          </h1>
          {snapshot && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted border border-border/50 text-[10px] font-bold text-muted-foreground uppercase tracking-tight">
              <span className="h-1 w-1 rounded-full bg-green-500" />
              {sites.length} {t('cookiesPage.labels.sites') || 'Sites'}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-full border border-border/60 px-3 text-xs font-bold uppercase tracking-wider hover:bg-muted"
            onClick={handleImportCookies}
            disabled={importing || loading}
          >
            <FileUp className="h-3.5 w-3.5 mr-2" />
            {t('cookiesPage.actions.import')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-full border border-border/60 px-3 text-xs font-bold uppercase tracking-wider hover:bg-muted"
            onClick={loadEntries}
            disabled={loading}
          >
            <RefreshCw className={cn('h-3.5 w-3.5 mr-2', loading && 'animate-spin')} />
            {t('cookiesPage.actions.refresh')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-3 text-xs font-bold uppercase tracking-wider text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={handleClearCookies}
            disabled={loading || isEmpty}
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" />
            {t('cookiesPage.actions.clear')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full pb-10">
          {/* 2. User Value as a Tip Block (matching Home's Cookies Tip) */}
          <div className="mx-6 mt-6 rounded-xl bg-muted/40 px-6 py-5 border border-border/50">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col items-start gap-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                    {t('cookiesPage.valueTitle').replace(/[:：]\s*$/, '')}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
                    {[
                      {
                        key: 'private',
                        text: t('cookiesPage.valueList.privateVideos'),
                        desc: t('cookiesPage.valueList.privateVideosDescription'),
                        icon: <Lock className="h-4 w-4 text-muted-foreground/60" />
                      },
                      {
                        key: 'success',
                        text: t('cookiesPage.valueList.higherSuccess'),
                        desc: t('cookiesPage.valueList.higherSuccessDescription'),
                        icon: <ShieldCheck className="h-4 w-4 text-muted-foreground/60" />
                      },
                      {
                        key: 'unlock',
                        text: t('cookiesPage.valueList.unlockQuality'),
                        desc: t('cookiesPage.valueList.unlockQualityDescription'),
                        icon: <Gem className="h-4 w-4 text-muted-foreground/60" />
                      }
                    ].map((item) => (
                      <div key={item.key} className="space-y-1.5 min-w-0">
                        <div className="flex items-center gap-2">
                          {item.icon}
                          <h3 className="font-bold text-xs uppercase tracking-tight text-foreground/90 truncate">
                            {item.text}
                          </h3>
                        </div>
                        <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                          {item.desc}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mx-6 mt-8 space-y-6">
            {/* 3. Site List Section */}
            <div className="flex items-center gap-3">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
                {t('cookiesPage.entriesTitle')}
              </h2>
              <div className="flex-1 h-px bg-border/40" />
              {snapshot && (
                <span className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">
                  {t('cookiesPage.lastSyncedAt', {
                    time: formatTimestamp(snapshot.createdAt)
                  })}
                </span>
              )}
            </div>

            {loading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 animate-pulse">
                {['s1', 's2', 's3', 's4', 's5', 's6'].map((key) => (
                  <div key={key} className="h-16 rounded-xl border border-border bg-muted/20" />
                ))}
              </div>
            )}

            {error && (
              <div className="p-8 text-center rounded-xl border border-red-100 bg-red-50/30 text-red-600">
                <p className="text-xs font-bold uppercase tracking-widest leading-none">{error}</p>
              </div>
            )}

            {isEmpty && !loading && (
              <div className="py-20 text-center rounded-xl border border-dashed border-border/60 bg-muted/10 flex flex-col items-center">
                <div className="w-12 h-12 rounded-full bg-background border border-border/60 flex items-center justify-center mb-4">
                  <FileUp className="h-5 w-5 text-muted-foreground/40" />
                </div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">
                  {t('cookiesPage.empty')}
                </p>
                <p className="text-[11px] text-muted-foreground/50 mb-6">
                  {t('cookiesPage.description')}
                </p>
                <Button
                  onClick={handleImportCookies}
                  variant="secondary"
                  className="rounded-full h-8 px-6 text-[11px] font-bold uppercase tracking-wider"
                >
                  {t('cookiesPage.actions.import')}
                </Button>
              </div>
            )}

            {!loading && !error && !isEmpty && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sites.map((site) => (
                  <div
                    key={site.domain}
                    className="group flex items-center gap-3 p-3 rounded-xl border border-border/80 bg-background transition-colors hover:bg-muted/30"
                  >
                    <div className="h-10 w-10 shrink-0 bg-white rounded-lg flex items-center justify-center overflow-hidden border border-border/40">
                      <RemoteImage
                        src={`https://unavatar.io/${site.domain}`}
                        alt={site.domain}
                        className="h-6 w-6 object-contain"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-bold truncate text-foreground/90 leading-tight mb-0.5">
                        {site.domain}
                      </p>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">
                        {site.count} {t('cookiesPage.labels.cookies')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="rounded-2xl border-none shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              {t('cookiesPage.clear.confirmTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('cookiesPage.clear.confirmMessage')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowClearConfirm(false)}
              className="rounded-full h-10 px-6 font-bold uppercase tracking-wider text-xs"
            >
              {t('cookiesPage.clear.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmClear}
              className="rounded-full h-10 px-6 font-bold uppercase tracking-wider text-xs"
            >
              {t('cookiesPage.clear.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
