import { Button } from '@renderer/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@renderer/components/ui/table'
import { formatAiCredits } from '@renderer/lib/ai-credits'
import { ipcServices } from '@renderer/lib/ipc'
import type { DesktopAiReservation } from '@shared/types/auth'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TABLE_CELL_CLASS, TABLE_HEAD_CLASS } from './account-table'

/** Show the tasks behind a hold and cancel through the server's fenced settlement path. */
export function CreditReservations(props: {
  error: boolean
  items: DesktopAiReservation[] | null
  onRefresh: () => Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const [now, setNow] = useState(Date.now)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState(false)
  const hasItems = Boolean(props.items?.length)

  useEffect(() => {
    if (!hasItems) {
      return
    }
    const interval = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(interval)
  }, [hasItems])

  /** Refresh both task details and the authoritative balance after the cancellation commits. */
  const cancelTask = async (requestId: string): Promise<void> => {
    setCancellingId(requestId)
    setCancelError(false)
    try {
      await ipcServices.account.cancelAiReservation(requestId)
      await props.onRefresh()
    } catch {
      setCancelError(true)
    } finally {
      setCancellingId(null)
    }
  }

  if (!(hasItems || props.error)) {
    return null
  }
  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' })

  return (
    <section aria-label={t('settings.account.reservationTitle')} className="mt-2 border-t pt-3">
      <h4 className="font-medium text-sm">{t('settings.account.reservationTitle')}</h4>
      {props.error ? (
        <p className="mt-2 text-destructive text-xs" role="status">
          {t('settings.account.reservationUnavailable')}
        </p>
      ) : null}
      {cancelError ? (
        <p className="mt-2 text-destructive text-xs" role="alert">
          {t('settings.account.reservationCancelError')}
        </p>
      ) : null}
      <Table aria-label={t('settings.account.reservationTitle')} className="mt-2">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={`${TABLE_HEAD_CLASS} pl-0`}>
              {t('settings.account.giftHistoryReason')}
            </TableHead>
            <TableHead className={`${TABLE_HEAD_CLASS} w-[8.5rem]`}>
              {t('settings.account.giftHistoryDate')}
            </TableHead>
            <TableHead className={`${TABLE_HEAD_CLASS} w-20 text-right`}>
              {t('settings.account.giftHistoryCredits')}
            </TableHead>
            <TableHead className={`${TABLE_HEAD_CLASS} w-24 pr-0`}>
              <span className="sr-only">{t('settings.account.reservationCancel')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.items?.map((item) => (
            <TableRow className="hover:bg-background/60" key={item.requestId}>
              <TableCell className={`${TABLE_CELL_CLASS} max-w-0 pl-0 font-medium`}>
                <p className="truncate" title={item.taskLabel || undefined}>
                  {item.taskLabel || t('settings.account.reservationTask')}
                </p>
              </TableCell>
              <TableCell className={`${TABLE_CELL_CLASS} text-muted-foreground`}>
                {item.status === 'reconciling'
                  ? t('settings.account.reservationReviewDeadline', {
                      time: time.format(item.expiresAt)
                    })
                  : t('settings.account.reservationElapsed', {
                      minutes: Math.max(0, Math.floor((now - item.createdAt) / 60_000))
                    })}
              </TableCell>
              <TableCell className={`${TABLE_CELL_CLASS} text-right font-medium tabular-nums`}>
                {formatAiCredits(item.reservedCredits)}
              </TableCell>
              <TableCell className={`${TABLE_CELL_CLASS} pr-0 text-right`}>
                {item.status === 'reconciling' ? (
                  <span className="text-muted-foreground text-xs">
                    {t('settings.account.reservationReview')}
                  </span>
                ) : (
                  <Button
                    className="h-6 px-2 text-muted-foreground text-xs"
                    disabled={cancellingId !== null}
                    onClick={() => void cancelTask(item.requestId)}
                    size="sm"
                    variant="ghost"
                  >
                    {t(
                      cancellingId === item.requestId
                        ? 'settings.account.reservationCancelling'
                        : 'settings.account.reservationCancel'
                    )}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
