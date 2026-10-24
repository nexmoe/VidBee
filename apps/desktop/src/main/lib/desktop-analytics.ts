import {
  DESKTOP_GA4_MEASUREMENT_ID,
  DESKTOP_GA4_ORIGIN,
  isDesktopAnalyticsDocument
} from '@shared/telemetry/desktop-analytics'
import type { BrowserWindow } from 'electron'
import { installGoogleAnalytics } from 'electron-ga4-telemetry/transport'
import log from 'electron-log/main'
import { settingsManager } from '../settings'
import { registerDesktopAnalyticsWindow } from './desktop-analytics-window'

let transport: ReturnType<typeof installGoogleAnalytics> | null = null

/** Install the isolated Google tag before creating the primary application window. */
export function initializeDesktopAnalytics(
  getMainWindow: () => BrowserWindow | null,
  rendererEntry: string,
  appVersion: string
): void {
  if (transport) {
    return
  }
  try {
    transport = installGoogleAnalytics({
      measurementId: DESKTOP_GA4_MEASUREMENT_ID,
      origin: DESKTOP_GA4_ORIGIN,
      /** Restrict analytics IPC to the primary window's application document. */
      isAllowedSender: (sender) =>
        sender === getMainWindow()?.webContents &&
        isDesktopAnalyticsDocument(sender.getURL(), rendererEntry),
      /** Read persisted consent before automatic initialization creates an identity or configures GA4. */
      renderer: () => ({
        enabled: settingsManager.get('enableAnalytics') !== false,
        autoPageViews: false,
        sendPageView: false,
        enhancedMeasurement: false,
        pageLocation: `${DESKTOP_GA4_ORIGIN}/desktop/home`,
        pageTitle: 'home',
        consent: {
          analytics_storage: 'granted',
          ad_storage: 'denied',
          ad_user_data: 'denied',
          ad_personalization: 'denied'
        },
        config: {
          app_name: 'VidBee',
          app_version: appVersion,
          client_channel: 'desktop',
          client_platform: process.platform,
          allow_google_signals: false,
          allow_ad_personalization_signals: false
        }
      }),
      /** Keep collector and persistence failures outside application business flows. */
      onError: (error) => log.warn(`[Analytics] ${error.code}`)
    })
    registerDesktopAnalyticsWindow(transport.collector)
  } catch (error) {
    log.warn('[Analytics] Failed to initialize Google Analytics:', error)
  }
}
