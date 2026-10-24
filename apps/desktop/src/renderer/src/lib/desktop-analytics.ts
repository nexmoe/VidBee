import {
  DESKTOP_GA4_MEASUREMENT_ID,
  DESKTOP_GA4_ORIGIN,
  type DesktopAnalyticsPage,
  desktopAnalyticsPage
} from '@shared/telemetry/desktop-analytics'
import { getDesktopGoogleAnalytics } from 'electron-ga4-telemetry/desktop'
import { logger } from './logger'

let client: ReturnType<typeof getDesktopGoogleAnalytics> | null = null
let enabled = false
let currentPage: DesktopAnalyticsPage | null = null
let previousPage: string | null = null
let synchronization = 0
let initialization: Promise<void> | null = null

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
    client.track('page_view', {
      ...currentPage,
      ...(referrer ? { page_referrer: referrer } : {})
    })
  } catch (error) {
    initialization = null
    logger.warn('[Analytics] Failed to synchronize Google Analytics:', error)
  }
}

/** Send product events to GA4 with sanitized screen metadata when analytics is enabled. */
export function trackDesktopEvent(eventName: string, properties?: Record<string, unknown>): void {
  if (!enabled) {
    return
  }
  client?.track(eventName, { ...properties, ...currentPage })
}
