import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { popularSites } from '@renderer/data/popularSites'
import { useTranslation } from 'react-i18next'

const referenceUrl = 'https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md'

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
        <ul className="grid gap-3 sm:grid-cols-2">
          {popularSites.map((site) => (
            <li key={site.id} className="rounded-md border border-border px-6 py-5">
              <p className="text-sm font-medium">{site.label}</p>
              {site.description ? (
                <p className="mt-1 text-xs text-muted-foreground">{site.description}</p>
              ) : null}
            </li>
          ))}
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
