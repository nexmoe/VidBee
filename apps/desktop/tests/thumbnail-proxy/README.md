# Thumbnail proxy regression

Run from the workspace root with Node **22.22.3**, pnpm **11.1.2**, and independent dependencies:

```sh
pnpm install --frozen-lockfile --store-dir .pnpm-store --network-concurrency 6 --child-concurrency 2
pnpm exec install-electron
pnpm --filter ./apps/desktop run prepare:native-deps
node apps/desktop/tests/thumbnail-proxy/build.mjs
node apps/desktop/tests/thumbnail-proxy/run.mjs
node apps/desktop/tests/thumbnail-proxy/coverage.mjs
pnpm run check
```

The launcher currently supports macOS. It copies Electron into `.cache/issue-474`, marks that copy as background-only, and prohibits activation before creating a hidden, unfocusable offscreen renderer. It fails on any show/focus event. It creates its own temporary profile, settings, download directory, database and dynamic loopback servers, passes an allowlist of environment variables to Electron, and removes the profile after the owned process exits. It does not launch the normal desktop entry point or connect to an existing application instance.

The fixture uses the production settings atom, IPC client and service registration, SettingsService, ThumbnailService, ThumbnailCache, and thumbnail hook. A minimal cover renders with that hook. It exercises the same persistence path used by Settings, without mounting the entire Settings page or download-list layout. The preload exposes real Electron invoke/events; it does not replace app services. Build adapters expand Vite's built-in skill-document glob and resolve workspace aliases without changing application logic.

HTTP forwarding and HTTPS CONNECT use real sockets and valid PNGs. Only the fixture's generated certificate is accepted inside its isolated Electron sessions. A synthetic cookie belongs to that temporary profile; the test verifies it never reaches image requests. No user credentials or cookies are read.

The download control uses the real facade, SQLite adapter, queue, executor and yt-dlp wrapper. Its owned executable implements only the output-path/progress contract and retrieves the controlled image using the emitted `--proxy`. This proves proxy propagation across persistence and the process/network boundary; it does not test YouTube extraction or real media output.

See [scenarios.md](scenarios.md) for the acceptance scenarios. Results, generated bundles and precise V8 coverage are written beneath `.cache/issue-474/receipts`, outside tracked source. The coverage gate includes all three changed production files and unexecuted function entries, and requires 70% of V8 function/block ranges. This is a V8 branch-range metric, not Istanbul or whole-application coverage. Remaining gaps include pre-existing image-format/MIME fallbacks, filesystem failures, transport-configuration failures and the hook's IPC-exception handler; the JSON report identifies untaken ranges.

At `587f0d0f8f1865dbf08a23afa3e8a013f4ed99e8`, the original isolated diagnostic reproduced two expected failures before this repair: saved-proxy thumbnail IPC returned `null` with zero proxy requests, and saving a working proxy left the same mounted cover missing. Direct DNS failure, an Electron Session proxy positive control, established cache behavior, and facade/queue/executor propagation passed. This repair covers that deterministic proxy-dependent subset of #474. The reporter's version, network, affected image URL and any extractor/account-specific failures remain unconfirmed.
