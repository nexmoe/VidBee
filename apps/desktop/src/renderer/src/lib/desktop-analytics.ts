import {
  DESKTOP_GA4_MEASUREMENT_ID,
  DESKTOP_GA4_ORIGIN,
  type DesktopAnalyticsPage,
  desktopAnalyticsPage
} from '@shared/telemetry/desktop-analytics'
import { getDesktopGoogleAnalytics } from 'electron-ga4-telemetry/desktop'
import { createDesktopValueCohorts } from './desktop-value-cohorts'
import { logger } from './logger'

let client: ReturnType<typeof getDesktopGoogleAnalytics> | null = null
let enabled = false
let currentPage: DesktopAnalyticsPage | null = null
let previousPage: string | null = null
let synchronization = 0
let initialization: Promise<void> | null = null
let appOpened = false
const cohorts = createDesktopValueCohorts(
  dispatchDesktopEvent,
  {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value)
  },
  `vidbee:analytics:${DESKTOP_GA4_MEASUREMENT_ID}`
)

/** Retry the SDK's initialization once after the application document and persisted settings load. */
async function prepareDesktopAnalytics(): Promise<void> {
  const configured = await window.electronGoogleTag?.ready()
  if (!configured) {
    // Electron may run the first preload before navigation commits; Main still validates this retry.
    await window.electron.ipcRenderer.invoke('electron-ga4:initialize')
  }
}

/** Apply loaded settings and track hash-router screens once after Main/Preload setup finishes. */
export async function syncDesktopAnalytics(
  analyticsEnabled: boolean,
  pathname: string
): Promise<void> {
  const generation = ++synchronization
  enabled = analyticsEnabled
  currentPage = desktopAnalyticsPage(pathname)
  if (!enabled) {
    client?.setEnabled(false)
    previousPage = null
  }
  if (!window.electronGoogleTag) {
    return
  }
  try {
    initialization ??= prepareDesktopAnalytics()
    await initialization
    if (generation !== synchronization) {
      return
    }
    client = getDesktopGoogleAnalytics({
      measurementId: DESKTOP_GA4_MEASUREMENT_ID,
      pageLocation: `${DESKTOP_GA4_ORIGIN}/desktop/home`,
      enabled: false,
      autoPageViews: false,
      sendPageView: false,
      enhancedMeasurement: false
    })
    client.setEnabled(enabled)
    if (!(enabled && currentPage) || previousPage === currentPage.page_location) {
      return
    }
    const referrer = previousPage
    previousPage = currentPage.page_location
    trackDesktopEvent('page_view', {
      ...(referrer ? { page_referrer: referrer } : {})
    })
    if (!appOpened) {
      appOpened = true
      trackDesktopEvent('desktop_app_opened')
      cohorts.opened()
    }
  } catch (error) {
    initialization = null
    logger.warn('[Analytics] Failed to synchronize Google Analytics:', error)
  }
}

/** Send product events to GA4 with sanitized screen metadata when analytics is enabled. */
export function trackDesktopEvent(
  eventName: string,
  properties?: Record<string, unknown>
): boolean {
  if (!(enabled && client)) {
    return false
  }
  return eventName === 'desktop_value_delivered'
    ? cohorts.value(properties)
    : dispatchDesktopEvent(eventName, properties)
}

/** Send safe payloads through the SDK without recursively entering cohort logic. */
function dispatchDesktopEvent(eventName: string, properties?: Record<string, unknown>): boolean {
  if (!(enabled && client)) {
    return false
  }
  try {
    client.track(eventName, {
      ...properties,
      ...currentPage,
      event_schema_version: '2',
      client_channel: 'desktop'
    })
    return true
  } catch (error) {
    logger.warn('[Analytics] Failed to dispatch product event:', error)
    return false
  }
}
