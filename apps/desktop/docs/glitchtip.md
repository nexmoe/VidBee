# GlitchTip integration

VidBee desktop now uses the Sentry-compatible GlitchTip stack in two layers:

1. Runtime collection via `@sentry/electron`
2. Release and source map upload via `@sentry/cli`

## Environment variables

Create `apps/desktop/.env` from [`apps/desktop/.env.example`](/Users/air15/Documents/GitHub/VidBee/apps/desktop/.env.example).

Required variables:

- `VITE_GLITCHTIP_DSN`: project DSN from GlitchTip
- `SENTRY_URL`: GlitchTip base URL, for example `https://glitchtip.example.com`
- `SENTRY_ORG`: GlitchTip organization slug
- `SENTRY_PROJECT`: GlitchTip project slug
- `SENTRY_AUTH_TOKEN`: auth token created in GlitchTip

Optional variables:

- `VITE_GLITCHTIP_ENVIRONMENT`: defaults to `production`
- `VITE_GLITCHTIP_ENVIRONMENT`: defaults to `production`

Release is automatic by default and does not need to be configured.
Both runtime reporting and `sentry-cli` use:

- `vidbee-desktop@<apps/desktop package version>`

Only add `VITE_GLITCHTIP_RELEASE` or `SENTRY_RELEASE` if you need a custom CI release name.

## Upload source maps

GlitchTip is Sentry API compatible, so `sentry-cli` can target it by setting `SENTRY_URL`.

Run:

```bash
pnpm --filter ./apps/desktop run build:glitchtip
```

This does the following:

1. Builds Electron main, preload, and renderer bundles with source maps enabled
2. Creates a release named `vidbee-desktop@<version>` by default
3. Uploads all source maps from `apps/desktop/out`
4. Finalizes the release

If `@sentry/cli` was installed with pnpm's build scripts blocked, run `pnpm approve-builds` and allow `@sentry/cli`.

## Event design

The integration is intentionally narrow:

- Main process:
  - uncaught exceptions
  - unhandled promise rejections
  - renderer crash and unresponsive state
  - yt-dlp, ffmpeg, auto-updater initialization failures
  - download failures
  - subscription sync, check, retry, and queue failures
- Renderer process:
  - `window.error`
  - `unhandledrejection`
  - React `ErrorBoundary` crashes
- Breadcrumbs:
  - deep link entry
  - page navigation
  - one-click download queue
  - subscription queue actions
  - update lifecycle milestones

This keeps GlitchTip focused on actionable failures while still preserving the timeline needed to debug them.
