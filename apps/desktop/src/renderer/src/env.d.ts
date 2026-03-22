/// <reference types="vite/client" />

interface RybbitClient {
  clearUserId: () => void
  event: (eventName: string, properties?: Record<string, unknown>) => void
  getUserId: () => string | null
  identify: (userId: string, traits?: Record<string, unknown>) => void
  pageview: () => void
  setTraits: (traits: Record<string, unknown>) => void
  trackOutbound: (url: string, text?: string, target?: string) => void
}

interface Window {
  rybbit?: RybbitClient
}
