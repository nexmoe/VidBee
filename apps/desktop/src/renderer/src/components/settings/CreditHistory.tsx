import { Button } from '@renderer/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@renderer/components/ui/table'
import { ipcServices } from '@renderer/lib/ipc'
import type { DesktopAiCreditHistory, DesktopAiCreditHistoryCursor } from '@shared/types/auth'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TABLE_CELL_CLASS, TABLE_HEAD_CLASS } from './account-table'

/** Explain individual credit charges on demand, including verified usage and compensating refunds. */
export function CreditHistory({ refreshVersion }: { refreshVersion: number }) {
  const { t, i18n } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState<DesktopAiCreditHistory | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const requestVersion = useRef(0)

  /** Ignore stale pages when the account changes, the section closes, or a refresh supersedes pagination. */
  const load = useCallback(async (cursor?: DesktopAiCreditHistoryCursor): Promise<void> => {
    const version = ++requestVersion.current
    setLoading(true)
    setError(false)
    try {
      const next = await ipcServices.account.getAiCreditHistory(cursor)
      if (version !== requestVersion.current) {
        return
      }
      setPage((previous) => ({
        ...next,
        items:
          cursor && previous
            ? [
                ...previous.items,
                ...next.items.filter((item) => !previous.items.some((old) => old.id === item.id))
              ]
            : next.items
      }))
    } catch {
      if (version === requestVersion.current) {
        setError(true)
      }
    } finally {
      if (version === requestVersion.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (expanded && refreshVersion >= 0) {
      void load()
    }
    return () => {
      requestVersion.current++
    }
  }, [expanded, refreshVersion, load])

  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
  const number = new Intl.NumberFormat(i18n.language)

  return (
    <details
      className="mt-2 border-t pt-3"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-muted-foreground text-xs transition-colors hover:text-foreground">
        {t('settings.account.creditHistoryTitle')}
      </summary>
      {error ? (
        <div className="mt-3 flex flex-wrap items-center gap-2" role="status">
          <p className="text-destructive text-xs">{t('settings.account.creditHistoryError')}</p>
          <Button onClick={() => void load()} size="sm" variant="outline">
            {t('settings.account.creditsRefresh')}
          </Button>
        </div>
      ) : null}
      {page?.items.length === 0 ? (
        <p className="mt-3 text-muted-foreground text-xs">
          {t('settings.account.creditHistoryEmpty')}
        </p>
      ) : null}
      {page?.items.length ? (
        <Table aria-label={t('settings.account.creditHistoryTitle')} className="mt-2">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={`${TABLE_HEAD_CLASS} pl-0`}>
                {t('settings.account.giftHistoryReason')}
              </TableHead>
              <TableHead className={`${TABLE_HEAD_CLASS} w-[8.5rem]`}>
                {t('settings.account.giftHistoryDate')}
              </TableHead>
              <TableHead className={`${TABLE_HEAD_CLASS} w-20 pr-0 text-right`}>
                {t('settings.account.giftHistoryCredits')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page?.items.map((item) => (
              <TableRow className="hover:bg-background/60" key={item.id}>
                <TableCell className={`${TABLE_CELL_CLASS} max-w-0 pl-0 font-medium`}>
                  <p className="truncate" title={item.taskLabel || undefined}>
                    {item.taskLabel || t('settings.account.reservationTask')}
                  </p>
                  {item.status === 'completed' ? null : (
                    <p className="mt-1 font-normal text-muted-foreground text-xs">
                      {t('settings.account.creditHistoryInterrupted')}
                    </p>
                  )}
                </TableCell>
                <TableCell className={`${TABLE_CELL_CLASS} text-muted-foreground`}>
                  <time dateTime={new Date(item.createdAt).toISOString()}>
                    {time.format(item.createdAt)}
                  </time>
                </TableCell>
                <TableCell
                  className={`${TABLE_CELL_CLASS} pr-0 text-right font-medium tabular-nums`}
                >
                  {item.credits
                    ? `−${number.format(item.credits)}`
                    : t('settings.account.creditHistoryNoCharge')}
                  {item.refundedCredits > 0 ? (
                    <p className="mt-1 font-normal text-muted-foreground text-xs">
                      {t('settings.account.creditHistoryRefunded', {
                        credits: number.format(item.refundedCredits)
                      })}
                    </p>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {loading ? (
        <p className="mt-3 text-muted-foreground text-xs" role="status">
          {t('settings.account.creditsLoading')}
        </p>
      ) : null}
      {page?.nextCursor ? (
        <Button
          className="mt-3"
          disabled={loading}
          onClick={() => void load(page.nextCursor ?? undefined)}
          size="sm"
          variant="outline"
        >
          {t('settings.account.loadMore')}
        </Button>
      ) : null}
    </details>
  )
}
