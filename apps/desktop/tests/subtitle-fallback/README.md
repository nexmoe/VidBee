# Optional subtitle recovery (#516)

Run with the repository's Node and pnpm versions after a frozen workspace install:

```sh
pnpm --filter vidbee run test:downloader
```

The command checks scenario structure with Vite's existing AST parser, runs Node's
built-in test runner, and enforces 70% Node V8 branch coverage over the **whole
`packages/downloader-core/src/yt-dlp-executor.ts` module**. Jiti loads the actual
workspace TypeScript with extension resolution; no application module is mocked.
Coverage is Node's V8 metric for the loaded module, not Istanbul coverage of the
whole application. Uncalled functions in that module remain in the denominator.

The suite uses the locked `yt-dlp-wrap-plus` adapter, real child processes, native
signals, real files, and an independent SQLite queue using the production DDL and
persistence adapter. A direct wrapper contract check confirms that exit 1 emits
`error` and exit 0 emits `close`. Native ChildProcess adapters also protect the
existing nonzero `close` path and a late close after a launch error.

The owned executable is a CLI protocol fixture for the reported French subtitle
429. It creates exact known bytes to verify output discovery and the nonempty
media guard; it does not implement YouTube extraction or prove playable media.
Each case owns a temporary directory and executable, with a private SQLite file
where needed. Cleanup uses original executor handles and owned children. No
browser, desktop instance, development server, user profile, network request,
credentials, or existing service is needed. The runner removes session secrets
and preload hooks from the test process environment.

Acceptance scenarios cover fresh subtitles-off video/audio, retained stored task
choices, successful/unavailable subtitles, one media-only recovery with explicit
opt-outs and failed subtitle acquisition, rolled-over output logs, second failure,
media 403, raw arguments/custom builders, initial/retry launch failures, pause and
cancel during both children and at the retry boundary, and stale first-process
output. Queue scenarios assert the final task state, real output bytes, and one
persisted attempt with one completion/close.

This repairs the existing optional-subtitle fallback. It does not establish why
every reported subtitles-disabled task requested French subtitles, or resolve
extractor/account/network-specific behavior on the reporter's Windows or Ubuntu
installation. Those paths remain unconfirmed.

The unchanged-source reproduction was retained separately from passing checks at
reviewed main `587f0d0f8f1865dbf08a23afa3e8a013f4ed99e8`: two controls pass and
the desired recovery fails as `http-429` with no media-only retry. The original
repair-session reproduction also passed fresh video/audio and stored-choice
controls before failing that recovery. The repair workspace keeps those logs,
the copied diagnostic executable harness, and the exact main source snapshot
under its ignored `.cache/issue-516` and `apps/desktop/.cache/issue-516-main`
directories. These expected pre-fix failures are not passing validation checks.

The branch gate covers the full changed production module. General configuration
and settings-preparation failures, some filesystem error branches, thumbnail-only
failure recovery, alternate output-log formats, and platform-specific process
handling are not exhaustively covered by this focused suite. The regression's
failure/retry/cancellation paths are exercised through real processes.
