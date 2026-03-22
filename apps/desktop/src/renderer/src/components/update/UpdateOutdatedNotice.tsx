import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import { updateAvailableAtom, updateReadyAtom } from '@renderer/store/update'
import { useAtomValue } from 'jotai'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface UpdateOutdatedNoticeProps {
  currentVersion: string
  onOpenAbout: () => void
}

const FORCE_UPDATE_NOTICE = import.meta.env.VITE_FORCE_UPDATE_NOTICE === '1'
const MINOR_VERSION_WEIGHT = 100
const MAJOR_VERSION_WEIGHT = 10_000
const OUTDATED_VERSION_DISTANCE_THRESHOLD = 3

const parseVersion = (version: string): [number, number, number] | null => {
  const parts = version.split(/[.-]/).slice(0, 3)
  if (parts.length === 0) {
    return null
  }

  const parsedParts = parts.map((part) => Number.parseInt(part, 10))
  if (parsedParts.some((part) => Number.isNaN(part))) {
    return null
  }

  return [parsedParts[0] ?? 0, parsedParts[1] ?? 0, parsedParts[2] ?? 0]
}

const getVersionDistance = (currentVersion: string, latestVersion: string): number | null => {
  const current = parseVersion(currentVersion)
  const latest = parseVersion(latestVersion)
  if (!(current && latest)) {
    return null
  }

  const [currentMajor, currentMinor, currentPatch] = current
  const [latestMajor, latestMinor, latestPatch] = latest

  if (
    latestMajor < currentMajor ||
    (latestMajor === currentMajor && latestMinor < currentMinor) ||
    (latestMajor === currentMajor && latestMinor === currentMinor && latestPatch <= currentPatch)
  ) {
    return 0
  }

  return (
    (latestMajor - currentMajor) * MAJOR_VERSION_WEIGHT +
    (latestMinor - currentMinor) * MINOR_VERSION_WEIGHT +
    (latestPatch - currentPatch)
  )
}

export function UpdateOutdatedNotice({ currentVersion, onOpenAbout }: UpdateOutdatedNoticeProps) {
  const { t } = useTranslation()
  const updateAvailable = useAtomValue(updateAvailableAtom)
  const updateReady = useAtomValue(updateReadyAtom)
  const effectiveCurrentVersion = FORCE_UPDATE_NOTICE
    ? (import.meta.env.VITE_FORCE_CURRENT_VERSION ?? currentVersion)
    : currentVersion
  const latestVersion = FORCE_UPDATE_NOTICE
    ? (import.meta.env.VITE_FORCE_LATEST_VERSION ?? updateAvailable.version ?? '')
    : (updateAvailable.version ?? '')
  const versionDistance = getVersionDistance(effectiveCurrentVersion, latestVersion)
  const shouldShow =
    Boolean(effectiveCurrentVersion) &&
    (FORCE_UPDATE_NOTICE || updateAvailable.available) &&
    !updateReady.ready &&
    Boolean(latestVersion) &&
    (versionDistance ?? 0) > OUTDATED_VERSION_DISTANCE_THRESHOLD

  if (!shouldShow) {
    return null
  }

  return (
    <Card className="mx-6 mt-4 border-destructive/30 bg-destructive/5 shadow-none">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-destructive/10 p-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <p className="font-medium text-sm">{t('about.latestVersionStatus.available')}</p>
            <p className="text-muted-foreground text-xs">
              {t('about.notifications.updateAvailable', { version: latestVersion })}
            </p>
            <p className="text-destructive text-xs">
              {t('about.notifications.outdatedVersionRisk')}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('about.versionLabel', { version: effectiveCurrentVersion })} /{' '}
              {t('about.latestVersionBadge', { version: latestVersion })}
            </p>
          </div>
        </div>
        <Button
          className="self-end sm:self-auto"
          onClick={onOpenAbout}
          size="sm"
          variant="destructive"
        >
          {t('about.actions.checkUpdates')}
        </Button>
      </CardContent>
    </Card>
  )
}
