import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle
} from '@renderer/components/ui/item'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@renderer/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import {
  creditUsageBarSegments,
  formatAiCredits,
  hasSplitCreditSources
} from '@renderer/lib/ai-credits'
import { ipcEvents, ipcServices } from '@renderer/lib/ipc'
import { buildLocalizedVidBeeUrl, withDesktopUtm } from '@renderer/lib/url'
import type {
  DesktopAiCreditSourceUsage,
  DesktopAiCreditUsage,
  DesktopAiReservation,
  DesktopAuthUser,
  DesktopGiftedCreditRecord,
  DesktopInvitationOverview,
  DesktopInvitedUser
} from '@shared/types/auth'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TABLE_CELL_CLASS, TABLE_HEAD_CLASS } from './account-table'
import { CreditHistory } from './CreditHistory'
import { CreditReservations } from './CreditReservations'

/** Normalize an Electron authentication failure for display. */
function authenticationErrorMessage(error: unknown, fallback: string): string {
  void error
  return fallback
}

/** Format an ISO timestamp in the user's active desktop locale. */
function formatDate(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(value))
}

/** Label a gifted allocation's expiry date, or an empty cell when it does not expire. */
function giftExpiryLabel(
  expiresAt: string | null,
  language: string,
  expiredLabel: (date: string) => string
): string {
  if (!expiresAt) {
    return ''
  }
  const date = formatDate(expiresAt, language)
  if (Date.parse(expiresAt) <= Date.now()) {
    return expiredLabel(date)
  }
  return date
}

/** Format used credits as a whole-number share of the quota. */
function formatCreditsUsedPercent(
  usedCredits: number,
  quotaCredits: number,
  language: string
): string {
  return new Intl.NumberFormat(language, {
    maximumFractionDigits: 0,
    style: 'percent'
  }).format(quotaCredits > 0 ? Math.min(1, Math.max(0, usedCredits / quotaCredits)) : 0)
}

/** Fill leftover quota with a tooltip only when leftover credits do not expire soon. */
function RemainingCreditTrack(props: { remainingLabel: string | null }) {
  const track = <div className="h-full flex-1" />
  if (!props.remainingLabel) {
    return track
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{track}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {props.remainingLabel}
      </TooltipContent>
    </Tooltip>
  )
}

type CreditBarTone = 'granted' | 'purchased'

const CREDIT_BAR_TONE: Record<CreditBarTone, { track: string; used: string }> = {
  granted: { track: 'bg-chart-2/20', used: 'bg-chart-2' },
  purchased: { track: 'bg-primary/20', used: 'bg-primary' }
}

/** Distinguish settled usage, active reservations, and available credits. */
function CreditUsageBar(props: {
  expiringSoonCredits: number
  remainingCredits: number
  reservedCredits: number
  source: CreditBarTone
  usedCredits: number
}) {
  const { t } = useTranslation()
  const tone = CREDIT_BAR_TONE[props.source]
  const segments = creditUsageBarSegments(props)
  const remainingStable = Math.max(0, props.remainingCredits - props.expiringSoonCredits)
  const usedLabel =
    props.usedCredits > 0
      ? t('settings.account.creditsTooltipUsed', { used: formatAiCredits(props.usedCredits) })
      : null
  const expiringLabel =
    props.expiringSoonCredits > 0
      ? t('settings.account.creditsTooltipExpiring', {
          credits: formatAiCredits(props.expiringSoonCredits)
        })
      : null
  const remainingLabel =
    remainingStable > 0
      ? t('settings.account.creditsTooltipRemaining', {
          credits: formatAiCredits(remainingStable)
        })
      : null
  const reservedLabel = t('settings.account.creditsReservedAmount', {
    credits: formatAiCredits(props.reservedCredits)
  })
  const label = [usedLabel, reservedLabel, expiringLabel, remainingLabel].filter(Boolean).join('. ')

  return (
    <div>
      <meter
        aria-label={label}
        className="sr-only"
        max={Math.max(props.usedCredits + props.reservedCredits + props.remainingCredits, 1)}
        value={props.usedCredits}
      />
      <div
        aria-hidden
        className={`flex h-2 w-full overflow-hidden rounded-full ${tone.track}`}
        data-credit-source={props.source}
      >
        {segments.usedPct > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={`h-full ${tone.used}`} style={{ width: `${segments.usedPct}%` }} />
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {usedLabel}
            </TooltipContent>
          </Tooltip>
        ) : null}
        {segments.reservedPct > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="h-full bg-sky-500" style={{ width: `${segments.reservedPct}%` }} />
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {reservedLabel}
            </TooltipContent>
          </Tooltip>
        ) : null}
        {segments.expiringPct > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="h-full bg-amber-500" style={{ width: `${segments.expiringPct}%` }} />
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {expiringLabel}
            </TooltipContent>
          </Tooltip>
        ) : null}
        {segments.stablePct > 0 ? <RemainingCreditTrack remainingLabel={remainingLabel} /> : null}
      </div>
    </div>
  )
}

/** Show available credits, and usage totals when they belong to a single credit source. */
function CreditUsageSummary(props: {
  remainingCredits: number
  reservedCredits: number
  usedCredits: number
  quotaCredits: number
  showPercent?: boolean
  showUsage: boolean
}) {
  const { i18n, t } = useTranslation()
  return (
    <p className="text-muted-foreground text-xs tabular-nums">
      <span className="font-medium text-foreground">
        {t('settings.account.creditsAvailableAmount', {
          credits: formatAiCredits(props.remainingCredits)
        })}
      </span>
      {props.showUsage ? (
        <>
          <span aria-hidden> · </span>
          <span>
            {t('settings.account.creditsUsage', {
              total: formatAiCredits(props.quotaCredits),
              used: formatAiCredits(props.usedCredits)
            })}
          </span>
        </>
      ) : null}
      {props.showPercent ? (
        <>
          <span aria-hidden> · </span>
          <span>
            {formatCreditsUsedPercent(props.usedCredits, props.quotaCredits, i18n.language)}
          </span>
        </>
      ) : null}
      {props.reservedCredits > 0 ? (
        <>
          <span aria-hidden> · </span>
          <span>
            {t('settings.account.creditsReservedAmount', {
              credits: formatAiCredits(props.reservedCredits)
            })}
          </span>
        </>
      ) : null}
    </p>
  )
}

/** Render one credit bar with its compact usage line, optionally labeled by source. */
function CreditBalanceBlock(props: {
  source: CreditBarTone
  title?: string
  usage: Pick<
    DesktopAiCreditSourceUsage,
    'expiringSoonCredits' | 'quotaCredits' | 'remainingCredits' | 'reservedCredits' | 'usedCredits'
  >
}) {
  const { i18n, t } = useTranslation()
  const percent = formatCreditsUsedPercent(
    props.usage.usedCredits,
    props.usage.quotaCredits,
    i18n.language
  )
  return (
    <div className="flex flex-col gap-2">
      {props.title ? (
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-medium text-foreground text-sm">{props.title}</p>
          <p className="shrink-0 text-muted-foreground text-sm tabular-nums">
            {t('settings.account.creditsUsedShare', { percent })}
          </p>
        </div>
      ) : null}
      <CreditUsageBar
        expiringSoonCredits={props.usage.expiringSoonCredits}
        remainingCredits={props.usage.remainingCredits}
        reservedCredits={props.usage.reservedCredits}
        source={props.source}
        usedCredits={props.usage.usedCredits}
      />
      <CreditUsageSummary
        quotaCredits={props.usage.quotaCredits}
        remainingCredits={props.usage.remainingCredits}
        reservedCredits={props.usage.reservedCredits}
        showPercent={!props.title}
        showUsage
        usedCredits={props.usage.usedCredits}
      />
    </div>
  )
}

/** Render a profile image or a stable text fallback without decorative icons. */
function AccountAvatar(props: { image: string | null; name: string; size?: 'large' | 'small' }) {
  const sizeClass = props.size === 'small' ? 'size-9' : 'size-12'
  if (props.image) {
    return (
      <img
        alt=""
        className={`${sizeClass} shrink-0 rounded-full object-cover`}
        height={props.size === 'small' ? 36 : 48}
        src={props.image}
        width={props.size === 'small' ? 36 : 48}
      />
    )
  }
  return (
    <span
      className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-full bg-background font-medium text-foreground`}
    >
      {props.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** Render invited users as a standard name / date / credits table. */
function InvitedUsersTable(props: {
  nextCursor: string | null
  onLoadMore: () => void
  users: DesktopInvitedUser[]
}) {
  const { i18n, t } = useTranslation()
  return (
    <>
      <Table aria-label={t('settings.account.invitedListTitle')}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={`${TABLE_HEAD_CLASS} pl-0`}>
              {t('settings.account.invitedColumnName')}
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
          {props.users.map((invitedUser) => (
            <TableRow className="hover:bg-background/60" key={invitedUser.id}>
              <TableCell className={`${TABLE_CELL_CLASS} pl-0`}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <AccountAvatar image={invitedUser.image} name={invitedUser.name} size="small" />
                  <span className="truncate font-medium">{invitedUser.name}</span>
                </div>
              </TableCell>
              <TableCell className={`${TABLE_CELL_CLASS} text-muted-foreground`}>
                {formatDate(invitedUser.createdAt, i18n.language)}
              </TableCell>
              <TableCell className={`${TABLE_CELL_CLASS} pr-0 text-right font-medium tabular-nums`}>
                +{formatAiCredits(invitedUser.rewardCredits)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {props.nextCursor ? (
        <Button onClick={props.onLoadMore} size="sm" variant="outline">
          {t('settings.account.loadMore')}
        </Button>
      ) : null}
    </>
  )
}

/** Render gifted credit records as a standard reason / date / expires / credits table. */
function GiftHistoryTable(props: {
  nextCursor: string | null
  onLoadMore: () => void
  records: DesktopGiftedCreditRecord[]
}) {
  const { i18n, t } = useTranslation()
  return (
    <>
      <Table aria-label={t('settings.account.giftHistoryTitle')}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={`${TABLE_HEAD_CLASS} pl-0`}>
              {t('settings.account.giftHistoryReason')}
            </TableHead>
            <TableHead className={`${TABLE_HEAD_CLASS} w-[8.5rem]`}>
              {t('settings.account.giftHistoryDate')}
            </TableHead>
            <TableHead className={`${TABLE_HEAD_CLASS} w-[8.5rem]`}>
              {t('settings.account.giftHistoryExpires')}
            </TableHead>
            <TableHead className={`${TABLE_HEAD_CLASS} w-20 pr-0 text-right`}>
              {t('settings.account.giftHistoryCredits')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.records.map((record) => (
            <TableRow className="hover:bg-background/60" key={record.id}>
              <TableCell className={`${TABLE_CELL_CLASS} whitespace-normal pl-0 font-medium`}>
                {t(`settings.account.giftReasons.${record.reason}`, {
                  name: record.relatedUser?.name ?? ''
                })}
              </TableCell>
              <TableCell className={`${TABLE_CELL_CLASS} text-muted-foreground`}>
                {formatDate(record.createdAt, i18n.language)}
              </TableCell>
              <TableCell className={`${TABLE_CELL_CLASS} text-muted-foreground`}>
                {giftExpiryLabel(record.expiresAt, i18n.language, (date) =>
                  t('settings.account.giftHistoryExpired', { date })
                )}
              </TableCell>
              <TableCell className={`${TABLE_CELL_CLASS} pr-0 text-right font-medium tabular-nums`}>
                +{formatAiCredits(record.credits)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {props.nextCursor ? (
        <Button onClick={props.onLoadMore} size="sm" variant="outline">
          {t('settings.account.loadMore')}
        </Button>
      ) : null}
    </>
  )
}

/** Render the optional GitHub account controls in Desktop preferences. */
export function AccountPanel() {
  const { t, i18n } = useTranslation()
  const [user, setUser] = useState<DesktopAuthUser | null>(null)
  const [credits, setCredits] = useState<DesktopAiCreditUsage | null>(null)
  const [overview, setOverview] = useState<DesktopInvitationOverview | null>(null)
  const [invitedUsers, setInvitedUsers] = useState<DesktopInvitedUser[]>([])
  const [invitedCursor, setInvitedCursor] = useState<string | null>(null)
  const [giftRecords, setGiftRecords] = useState<DesktopGiftedCreditRecord[]>([])
  const [giftCursor, setGiftCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [accountDataLoading, setAccountDataLoading] = useState(false)
  const [working, setWorking] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [accountDataError, setAccountDataError] = useState(false)
  const [reservations, setReservations] = useState<DesktopAiReservation[] | null>(null)
  const [reservationsError, setReservationsError] = useState(false)
  const creditRequestVersion = useRef(0)
  const [creditHistoryVersion, setCreditHistoryVersion] = useState(0)

  /** Ignore stale account responses and refresh the balance alongside its underlying holds. */
  const refreshCreditData = useCallback(async (): Promise<void> => {
    const version = ++creditRequestVersion.current
    const [balance, tasks] = await Promise.allSettled([
      ipcServices.account.getAiCredits(),
      ipcServices.account.getAiReservations()
    ])
    if (version !== creditRequestVersion.current) {
      return
    }
    setCreditHistoryVersion(version)
    if (balance.status === 'fulfilled') {
      setCredits(balance.value)
    }
    if (tasks.status === 'fulfilled') {
      setReservations(tasks.value)
    }
    setAccountDataError(balance.status === 'rejected')
    setReservationsError(tasks.status === 'rejected')
  }, [])

  const hasReservedCredits = (credits?.reservedCredits ?? 0) > 0
  useEffect(() => {
    if (!user) {
      return
    }
    /** Refresh active holds while visible and whenever the account regains focus. */
    const refreshVisible = () => {
      if (!document.hidden) {
        void refreshCreditData()
      }
    }
    window.addEventListener('focus', refreshVisible)
    const subscription = ipcEvents.on('account:credits-updated', refreshVisible)
    const interval = hasReservedCredits ? setInterval(refreshVisible, 15_000) : undefined
    return () => {
      window.removeEventListener('focus', refreshVisible)
      ipcEvents.removeListener('account:credits-updated', subscription)
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [user, hasReservedCredits, refreshCreditData])
  const [copied, setCopied] = useState(false)

  /** Refresh credits and the first invitation pages through the secure main bridge. */
  const refreshAccountData = useCallback(async () => {
    setAccountDataLoading(true)
    setAccountDataError(false)
    try {
      const [, nextOverview, nextInvitedUsers, nextGiftRecords] = await Promise.allSettled([
        refreshCreditData(),
        ipcServices.account.getInvitationOverview(),
        ipcServices.account.getInvitedUsers(),
        ipcServices.account.getGiftedCreditRecords()
      ])
      if (nextOverview.status === 'fulfilled') {
        setOverview(nextOverview.value)
      }
      if (nextInvitedUsers.status === 'fulfilled') {
        setInvitedUsers(nextInvitedUsers.value.items)
        setInvitedCursor(nextInvitedUsers.value.nextCursor)
      }
      if (nextGiftRecords.status === 'fulfilled') {
        setGiftRecords(nextGiftRecords.value.items)
        setGiftCursor(nextGiftRecords.value.nextCursor)
      }
    } catch {
      setAccountDataError(true)
    } finally {
      setAccountDataLoading(false)
    }
  }, [refreshCreditData])

  useEffect(() => {
    let active = true
    void window
      .getUser()
      .then((nextUser) => {
        if (active) {
          setUser(nextUser as DesktopAuthUser | null)
          if (nextUser) {
            void refreshAccountData()
          }
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setErrorMessage(authenticationErrorMessage(error, t('settings.account.error')))
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    const removeAuthenticated = window.onAuthenticated((nextUser) => {
      setUser(nextUser as DesktopAuthUser)
      void refreshAccountData()
      setWorking(false)
      setErrorMessage(null)
    })
    const removeUpdated = window.onUserUpdated((nextUser) => {
      setUser(nextUser as DesktopAuthUser | null)
      if (nextUser) {
        void refreshAccountData()
      } else {
        creditRequestVersion.current++
        setCredits(null)
        setReservations(null)
        setOverview(null)
        setInvitedUsers([])
        setGiftRecords([])
      }
      setWorking(false)
    })
    const removeError = window.onAuthError((error) => {
      setErrorMessage(authenticationErrorMessage(error, t('settings.account.error')))
      setWorking(false)
    })

    return () => {
      active = false
      creditRequestVersion.current++
      removeAuthenticated()
      removeUpdated()
      removeError()
    }
  }, [refreshAccountData, t])

  /** Open localized pricing and bind checkout to the current desktop account. */
  const topUpCredits = useCallback(async () => {
    if (!user) {
      return
    }
    const url = new URL(buildLocalizedVidBeeUrl('/pricing/', i18n.language))
    url.searchParams.set('from', 'desktop')
    url.searchParams.set('account', user.id)
    setErrorMessage(null)
    try {
      await ipcServices.fs.openExternal(withDesktopUtm(url.toString()))
    } catch {
      setErrorMessage(t('settings.account.creditsTopUpError'))
    }
  }, [i18n.language, t, user])

  /** Open the system browser at the GitHub sign-in flow. */
  const signIn = useCallback(async () => {
    setErrorMessage(null)
    setWorking(true)
    try {
      await window.requestAuth()
    } catch (error) {
      setErrorMessage(authenticationErrorMessage(error, t('settings.account.error')))
      setWorking(false)
    }
  }, [t])

  /** End the stored desktop session and reset the visible account. */
  const signOut = useCallback(async () => {
    setErrorMessage(null)
    setWorking(true)
    try {
      await window.signOut()
      setUser(null)
      creditRequestVersion.current++
      setReservations(null)
      setCredits(null)
      setOverview(null)
      setInvitedUsers([])
      setGiftRecords([])
    } catch (error) {
      setErrorMessage(authenticationErrorMessage(error, t('settings.account.error')))
    } finally {
      setWorking(false)
    }
  }, [t])

  /** Copy the permanent invitation link to the system clipboard. */
  const copyInviteLink = useCallback(async () => {
    if (!overview) {
      return
    }
    await navigator.clipboard.writeText(overview.inviteUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }, [overview])

  /** Append the next page of privacy-safe invited users. */
  const loadMoreInvitedUsers = useCallback(async () => {
    if (!invitedCursor) {
      return
    }
    const page = await ipcServices.account.getInvitedUsers(invitedCursor)
    setInvitedUsers((current) => [...current, ...page.items])
    setInvitedCursor(page.nextCursor)
  }, [invitedCursor])

  /** Append the next page of gifted credit records. */
  const loadMoreGiftRecords = useCallback(async () => {
    if (!giftCursor) {
      return
    }
    const page = await ipcServices.account.getGiftedCreditRecords(giftCursor)
    setGiftRecords((current) => [...current, ...page.items])
    setGiftCursor(page.nextCursor)
  }, [giftCursor])

  if (loading) {
    return (
      <div
        className="flex min-h-40 items-center justify-center text-muted-foreground"
        role="status"
      >
        {t('settings.account.loading')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {errorMessage ? (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive text-sm"
          role="alert"
        >
          {errorMessage}
        </div>
      ) : null}

      <ItemGroup>
        <Item variant="muted">
          <ItemMedia
            className={user?.image ? 'size-12 rounded-full' : undefined}
            variant={user?.image ? 'image' : 'default'}
          >
            <AccountAvatar
              image={user?.image ?? null}
              name={user?.name ?? t('settings.account.signedOut')}
            />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{user ? user.name : t('settings.account.signedOut')}</ItemTitle>
            <ItemDescription>
              {user ? user.email : t('settings.account.description')}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            {user ? (
              <Button disabled={working} onClick={() => void signOut()} variant="outline">
                {working ? t('settings.account.signingOut') : t('settings.account.signOut')}
              </Button>
            ) : (
              <Button disabled={working} onClick={() => void signIn()}>
                {working ? t('settings.account.signingIn') : t('settings.account.signIn')}
              </Button>
            )}
          </ItemActions>
        </Item>
      </ItemGroup>

      {user ? (
        <ItemGroup>
          <Item variant="muted">
            <ItemContent className="gap-5">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="min-w-0 space-y-1">
                  <ItemTitle>{t('settings.account.creditsTitle')}</ItemTitle>
                  {credits && hasSplitCreditSources(credits) ? (
                    <CreditUsageSummary
                      quotaCredits={credits.quotaCredits}
                      remainingCredits={credits.remainingCredits}
                      reservedCredits={credits.reservedCredits}
                      showUsage={false}
                      usedCredits={credits.usedCredits}
                    />
                  ) : null}
                </div>
                <Button className="shrink-0" onClick={() => void topUpCredits()} size="sm">
                  {t('settings.account.creditsTopUp')}
                </Button>
              </div>
              <p className="sr-only">{t('settings.account.creditsDescription')}</p>
              {credits ? (
                <>
                  {hasSplitCreditSources(credits) && credits.bySource ? (
                    <div className="flex flex-col gap-5">
                      <CreditBalanceBlock
                        source="granted"
                        title={t('settings.account.grantedCredits')}
                        usage={credits.bySource.granted}
                      />
                      <CreditBalanceBlock
                        source="purchased"
                        title={t('settings.account.purchasedCredits')}
                        usage={credits.bySource.purchased}
                      />
                    </div>
                  ) : (
                    <CreditBalanceBlock source="purchased" usage={credits} />
                  )}
                  {(credits.reconcilingCredits ?? 0) > 0 ? (
                    <p className="text-muted-foreground text-xs">
                      {t('settings.account.creditsReviewAmount', {
                        credits: formatAiCredits(credits.reconcilingCredits ?? 0)
                      })}
                    </p>
                  ) : null}
                  <CreditReservations
                    error={reservationsError}
                    items={reservations}
                    onRefresh={refreshCreditData}
                  />
                  <CreditHistory key={user.id} refreshVersion={creditHistoryVersion} />
                  {accountDataError ? (
                    <p className="text-destructive text-sm" role="status">
                      {t('settings.account.creditsStale')}
                    </p>
                  ) : null}
                </>
              ) : (
                <ItemDescription>
                  {accountDataLoading
                    ? t('settings.account.creditsLoading')
                    : accountDataError
                      ? t('settings.account.creditsError')
                      : null}
                </ItemDescription>
              )}
            </ItemContent>
          </Item>
        </ItemGroup>
      ) : null}

      {user ? (
        <ItemGroup>
          <Item className="items-start" variant="muted">
            <ItemContent className="gap-3">
              <div>
                <ItemTitle>
                  {t('settings.account.inviteTitle')}
                  <Badge variant="secondary">{t('settings.account.inviteLimitedBadge')}</Badge>
                </ItemTitle>
                <ItemDescription className="line-clamp-none">
                  {t('settings.account.inviteDescription')}
                </ItemDescription>
              </div>
              {overview ? (
                <>
                  <div className="flex items-stretch gap-2">
                    <code className="flex min-w-0 flex-1 items-center rounded-md bg-background px-3 py-2 font-semibold tracking-widest">
                      {overview.code}
                    </code>
                    <Button
                      className="shrink-0"
                      onClick={() => void copyInviteLink()}
                      variant="outline"
                    >
                      {copied
                        ? t('settings.account.inviteCopied')
                        : t('settings.account.copyInviteLink')}
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-background px-3 py-2.5">
                      <div className="font-semibold text-lg tabular-nums">
                        {overview.invitedUsers}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {t('settings.account.invitedUsers')}
                      </div>
                    </div>
                    <div className="rounded-lg bg-background px-3 py-2.5">
                      <div className="font-semibold text-lg tabular-nums">
                        {formatAiCredits(overview.earnedCredits)}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {t('settings.account.inviteCreditsEarned')}
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </ItemContent>
          </Item>

          {invitedUsers.length > 0 ? <ItemSeparator /> : null}
          {invitedUsers.length > 0 ? (
            <Item className="items-start" variant="muted">
              <ItemContent className="gap-3">
                <ItemTitle>{t('settings.account.invitedListTitle')}</ItemTitle>
                <InvitedUsersTable
                  nextCursor={invitedCursor}
                  onLoadMore={() => void loadMoreInvitedUsers()}
                  users={invitedUsers}
                />
              </ItemContent>
            </Item>
          ) : null}

          {giftRecords.length > 0 ? <ItemSeparator /> : null}
          {giftRecords.length > 0 ? (
            <Item className="items-start" variant="muted">
              <ItemContent className="gap-3">
                <ItemTitle>{t('settings.account.giftHistoryTitle')}</ItemTitle>
                <GiftHistoryTable
                  nextCursor={giftCursor}
                  onLoadMore={() => void loadMoreGiftRecords()}
                  records={giftRecords}
                />
              </ItemContent>
            </Item>
          ) : null}
        </ItemGroup>
      ) : null}
    </div>
  )
}
