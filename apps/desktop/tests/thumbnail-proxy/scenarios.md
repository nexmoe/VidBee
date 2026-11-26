# Issue 474 isolated diagnostic acceptance

- Scenario: user loads a list cover available only through the saved HTTP proxy
  - Given a fresh profile, a reserved `.invalid` image hostname and an owned loopback forward proxy.
  - When the user saves the proxy and the renderer requests the cover through real thumbnail IPC.
  - Then the cache returns an app URL containing byte-identical, decodable PNG data; direct access fails.
- Scenario: user repairs a failed cover by saving a different proxy without changing its URL
  - Given an already mounted cover whose first request failed.
  - When the user saves a working proxy through the settings atom and real settings IPC.
  - Then that same component shows the same cover URL without remounting.
- Scenario: user switches proxies while the previous cover request is pending
  - Given an old proxy that withholds its response and a new proxy that serves a different valid PNG.
  - When the new request succeeds and the old response is released.
  - Then the old work cannot overwrite the renderer result or cached image.
- Scenario: user retains established thumbnail behavior
  - Given valid disk cache hits, local/data URLs, malformed URLs, non-image responses and a stalled response.
  - When the cache is requested repeatedly or after failure.
  - Then valid hits/local values remain usable, invalid responses do not persist, and stalled work terminates and cleans up so retry can succeed.
- Scenario: user downloads with the same saved proxy
  - Given synthetic display metadata, an isolated queue/database and an owned executable protocol fixture.
  - When the real facade prepares the task and the real queue/executor launches it.
  - Then the executable receives the saved proxy and original thumbnail URL and completes with a temporary output.

Scope: deterministic proxy-dependent subset of missing list covers; no reporter account, cookies or public YouTube access is used. The executable fixture verifies wrapper/process/argv contracts, not YouTube extraction.
