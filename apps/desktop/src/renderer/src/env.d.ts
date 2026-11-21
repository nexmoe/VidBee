/// <reference types="vite/client" />

interface Document {
  readonly activeViewTransition?: ViewTransition | null
}

interface Window {
  electronGoogleTag?: {
    ready: () => Promise<string | null>
  }
}
