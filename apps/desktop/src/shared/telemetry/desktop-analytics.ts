export const DESKTOP_GA4_MEASUREMENT_ID = 'G-0FFYFJW9D4'
export const DESKTOP_GA4_ORIGIN = 'https://desktop.vidbee.org'

export interface DesktopAnalyticsPage {
  page_location: string
  page_title: string
}

/** Map application routes to fixed labels without sending IDs, searches or local paths. */
export function desktopAnalyticsPage(pathname: string): DesktopAnalyticsPage | null {
  let screen: string
  switch (pathname) {
    case '/':
      screen = 'home'
      break
    case '/subscriptions':
      screen = 'subscriptions'
      break
    case '/settings':
      screen = 'settings'
      break
    case '/about':
      screen = 'about'
      break
    default:
      if (!/^\/downloads\/[^/]+\/transcript\/?$/.test(pathname)) {
        return null
      }
      screen = 'transcript'
  }
  return { page_location: `${DESKTOP_GA4_ORIGIN}/desktop/${screen}`, page_title: screen }
}

/** Trust only the configured application document, allowing its hash router to navigate. */
export function isDesktopAnalyticsDocument(candidate: string, rendererEntry: string): boolean {
  try {
    const actual = new URL(candidate)
    const expected = new URL(rendererEntry)
    return (
      actual.protocol === expected.protocol &&
      actual.host === expected.host &&
      actual.pathname === expected.pathname &&
      actual.search === expected.search &&
      !actual.username &&
      !actual.password
    )
  } catch {
    return false
  }
}
