const RYBBIT_DEVICE_USER_ID_STORAGE_KEY = 'vidbee.desktop.rybbit.device-user-id'
const RYBBIT_DAILY_VERSION_STORAGE_KEY = 'vidbee.desktop.rybbit.daily-client-version'
const RYBBIT_DAILY_VERSION_EVENT_NAME = 'client_version_daily'
const RYBBIT_CHANNEL = 'desktop'

interface DailyVersionSnapshot {
  dayKey: string
}

interface TrackDailyClientVersionOptions {
  appName: string
  platform: string
  userId: string
  version: string
}

const padNumber = (value: number): string => {
  return value.toString().padStart(2, '0')
}

const getCurrentDayKey = (): string => {
  const now = new Date()
  const year = now.getFullYear()
  const month = padNumber(now.getMonth() + 1)
  const day = padNumber(now.getDate())
  return `${year}-${month}-${day}`
}

const getNextDayDelayMs = (): number => {
  const now = new Date()
  const nextDay = new Date(now)
  nextDay.setHours(24, 0, 5, 0)
  return Math.max(nextDay.getTime() - now.getTime(), 1000)
}

const readDailyVersionSnapshot = (userId: string): DailyVersionSnapshot | null => {
  const rawValue = window.localStorage.getItem(`${RYBBIT_DAILY_VERSION_STORAGE_KEY}:${userId}`)
  if (!rawValue) {
    return null
  }

  try {
    const parsedValue = JSON.parse(rawValue) as DailyVersionSnapshot
    if (typeof parsedValue.dayKey !== 'string') {
      return null
    }

    return parsedValue
  } catch {
    return null
  }
}

const writeDailyVersionSnapshot = (userId: string, snapshot: DailyVersionSnapshot): void => {
  window.localStorage.setItem(
    `${RYBBIT_DAILY_VERSION_STORAGE_KEY}:${userId}`,
    JSON.stringify(snapshot)
  )
}

const getOrCreateRybbitDeviceUserId = (): string => {
  const existingUserId = window.localStorage.getItem(RYBBIT_DEVICE_USER_ID_STORAGE_KEY)
  if (existingUserId) {
    return existingUserId
  }

  const userId = `desktop-install:${crypto.randomUUID()}`
  window.localStorage.setItem(RYBBIT_DEVICE_USER_ID_STORAGE_KEY, userId)
  return userId
}

const buildClientVersionTraits = ({
  appName,
  platform,
  version
}: Omit<TrackDailyClientVersionOptions, 'userId'>): Record<string, string> => {
  return {
    app_name: appName,
    client_channel: RYBBIT_CHANNEL,
    client_platform: platform,
    client_version: version
  }
}

const trackDailyClientVersion = ({
  appName,
  platform,
  userId,
  version
}: TrackDailyClientVersionOptions): void => {
  const rybbitClient = window.rybbit
  if (!rybbitClient) {
    return
  }

  const dayKey = getCurrentDayKey()
  const traits = buildClientVersionTraits({
    appName,
    platform,
    version
  })

  rybbitClient.identify(userId, traits)

  const trackedSnapshot = readDailyVersionSnapshot(userId)
  if (trackedSnapshot?.dayKey === dayKey) {
    return
  }

  rybbitClient.event(RYBBIT_DAILY_VERSION_EVENT_NAME, traits)
  writeDailyVersionSnapshot(userId, { dayKey })
}

export { getNextDayDelayMs, getOrCreateRybbitDeviceUserId, trackDailyClientVersion }
