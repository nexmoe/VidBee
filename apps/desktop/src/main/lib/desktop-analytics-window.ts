const collectors = new WeakSet<object>()

/** Mark a collector so native application actions never select it as an interactive window. */
export function registerDesktopAnalyticsWindow(window: object): void {
  collectors.add(window)
}

/** Recognize collector windows without importing the telemetry runtime or application settings. */
export function isDesktopAnalyticsWindow(window: object): boolean {
  return collectors.has(window)
}
