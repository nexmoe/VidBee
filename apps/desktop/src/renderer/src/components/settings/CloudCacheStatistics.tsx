import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@renderer/components/ui/table'
import { ipcServices } from '@renderer/lib/ipc'
import type { DesktopCloudCacheStats } from '@shared/types/auth'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Show aggregate UTC cache counts without averaging daily hit percentages. */
export function CloudCacheStatistics() {
  const { t, i18n } = useTranslation()
  const [stats, setStats] = useState<DesktopCloudCacheStats | null>(null)
  useEffect(() => {
    let active = true
    void ipcServices.account
      .getCacheStats()
      .then((value) => {
        if (active) {
          setStats(value)
        }
      })
      .catch(() => {
        /* Statistics do not block account controls. */
      })
    return () => {
      active = false
    }
  }, [])
  if (!stats) {
    return null
  }
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 1
  })
  return (
    <section aria-label={t('cloudCache.title')} className="rounded-lg bg-muted/50 p-4">
      <h3 className="mb-3 font-medium text-sm">{t('cloudCache.title')}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            {(['range', 'hits', 'misses', 'bypasses', 'hitRate'] as const).map((key) => (
              <TableHead key={key}>{t(`cloudCache.${key}`)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {(['today', 'week', 'month', 'all'] as const).map((range) => (
            <TableRow key={range}>
              <TableCell>{t(`cloudCache.${range}`)}</TableCell>
              <TableCell>{stats[range].hits}</TableCell>
              <TableCell>{stats[range].misses}</TableCell>
              <TableCell>{stats[range].bypasses}</TableCell>
              <TableCell>
                {stats[range].hitRate === null ? '—' : percent.format(stats[range].hitRate)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
