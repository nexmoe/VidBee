import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { ImageWithPlaceholder } from '@renderer/components/ui/image-with-placeholder'
import { popularSites } from '@renderer/data/popularSites'
import { ipcServices } from '@renderer/lib/ipc'
import { ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const referenceUrl = 'https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md'

function SiteIcon({ domain, alt }: { domain: string; alt: string }) {
  const [iconUrl, setIconUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadIcon = async () => {
      try {
        const dataUrl = await ipcServices.app.getSiteIcon(domain)
        if (!cancelled) {
          setIconUrl(dataUrl)
        }
      } catch (error) {
        console.error('Failed to load site icon:', error)
        if (!cancelled) {
          setIconUrl(null)
        }
      }
    }

    void loadIcon()

    return () => {
      cancelled = true
    }
  }, [domain])

  return <ImageWithPlaceholder src={iconUrl || undefined} alt={alt} className="w-full h-full" />
}

export function SupportedSites() {
  const { t } = useTranslation()

  return (
    <div className="container mx-auto max-w-5xl p-6 space-y-6" style={{ maxWidth: '100%' }}>
      <Card>
        <CardHeader>
          <CardTitle>{t('sites.pageTitle')}</CardTitle>
          <CardDescription>{t('sites.pageDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('sites.pageIntro')}</p>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold px-6">{t('sites.popularSection')}</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {popularSites.map((site) => {
            const labelKey = `sites.popular.${site.id}.label`
            const descriptionKey = `sites.popular.${site.id}.description`
            const label = t(labelKey)
            const description = t(descriptionKey)
            const hasDescription = description !== descriptionKey

            return (
              <li key={site.id}>
                <a
                  href={site.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-md border border-border px-4 py-3 transition-colors hover:bg-muted/50 hover:border-primary/50 group"
                >
                  <div className="shrink-0 w-10 h-10 rounded-xs overflow-hidden">
                    <SiteIcon domain={site.domain} alt={label} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{label}</p>
                      <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                    {hasDescription ? (
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                        {description}
                      </p>
                    ) : null}
                  </div>
                </a>
              </li>
            )
          })}
        </ul>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t('sites.moreTitle')}</CardTitle>
          <CardDescription>{t('sites.moreDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <a href={referenceUrl} target="_blank" rel="noreferrer">
              {t('sites.openFullList')}
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
