# Master Prompt — Anti-Gravity IDE (SpecKit + open-spec)
## VidBee: Pause/Resume Active Downloads Feature

> Paste this entire prompt into Anti-Gravity after installing SpecKit and open-spec, with the VidBee repo open on the `feature/pause-resume` branch.

---

```
## Objective
Implement the Pause/Resume feature for active downloads in VidBee — an Electron desktop app. The full spec is in PRD.md, TRD.md, and APPFLOW.md (already loaded via open-spec). Implement exactly what the spec says. Do not add features beyond the spec scope.

## Context
- Repo: nexmoe/VidBee (your fork, feature/pause-resume branch)
- Stack: Electron 38 · electron-vite · React 19 · Jotai · Tailwind CSS 4 · shadcn/ui · TypeScript 5 · yt-dlp · pnpm
- The app spawns yt-dlp as a child process for each download.
- Existing download states: queued | downloading | completed | error | cancelled
- Icons available: Lucide (already installed). Use <Pause /> and <Play /> for the buttons.
- UI components available: shadcn/ui Button (already installed).
- State management: Jotai atoms (locate the existing download atom before writing new code).
- i18n: react-i18next. ALL new UI strings MUST go in apps/desktop/src/renderer/src/locales/en.json.
- No new npm dependencies without asking me first.

## What Was Tried / Failed
Nothing yet — this is a fresh implementation on a clean feature branch.

## Target State
The following must be true when you're done:

1. A Pause button (Lucide <Pause /> icon) appears on every download row with status === 'downloading'.
2. Clicking Pause:
   - On macOS/Linux: sends SIGSTOP to the yt-dlp child process.
   - On Windows: sends SIGTERM to gracefully stop yt-dlp (partial .part file is preserved by yt-dlp natively).
   - Updates download state to 'paused'.
   - Progress bar freezes at current percent.
   - Status badge shows "Paused".
3. A Resume button (Lucide <Play /> icon) appears on every download row with status === 'paused', replacing Pause.
4. Clicking Resume:
   - On macOS/Linux: sends SIGCONT to the suspended process.
   - On Windows: re-spawns yt-dlp with the original args + --continue flag so it appends to the .part file.
   - Updates download state back to 'downloading'.
   - Progress bar animates from last known percent.
5. All new strings in en.json: "pause", "resume", "paused".
6. pnpm run typecheck → 0 errors.
7. pnpm run check → 0 Biome errors.

## Scope — Work ONLY in these files
- apps/desktop/src/main/download-manager.ts (or equivalent main-process file that spawns yt-dlp)
- apps/desktop/src/main/ipc-handlers.ts (or where ipcMain.handle calls live)
- apps/desktop/src/preload/index.ts
- apps/desktop/src/renderer/src/hooks/ (the file containing download state/atoms)
- apps/desktop/src/renderer/src/components/ (the download row/item component)
- apps/desktop/src/renderer/src/locales/en.json

Do NOT touch:
- .env files
- pnpm-lock.yaml
- package.json (no new deps without asking)
- Any file outside the apps/desktop directory
- Any file unrelated to download state, IPC, or the download UI component

## Implementation Order
Think carefully and step-by-step before starting. Then execute in this order:

Step 1 — Read before writing.
  Scan and show me the current content of:
  (a) The DownloadStatus type definition (wherever it lives)
  (b) The main-process file where yt-dlp is spawned
  (c) The preload context bridge
  (d) The download item/row component
  Then confirm your understanding of the existing shape before touching any file.

Step 2 — Extend DownloadStatus type.
  Add 'paused' to the union. Run typecheck. Fix all resulting type errors in one pass.
  ✅ After: pnpm run typecheck passes.

Step 3 — Main process.
  Add a Map<string, ChildProcess> to track active processes.
  Store original yt-dlp args per download id (required for Windows resume).
  Implement pauseDownload(id) with platform detection.
  Implement resumeDownload(id, args) with platform detection.
  ✅ After: show me the final pauseDownload and resumeDownload functions.

Step 4 — IPC handlers.
  Register 'download:pause' and 'download:resume' with ipcMain.handle.
  ✅ After: show me the two new handler registrations.

Step 5 — Preload.
  Expose pauseDownload and resumeDownload on window.api via contextBridge.
  ✅ After: show me the updated exposeInMainWorld block.

Step 6 — Renderer atoms/hooks.
  Add pause and resume action dispatchers that call window.api and update Jotai state.
  ✅ After: show me the two new atom actions.

Step 7 — UI component.
  Add conditional Pause button (status === 'downloading') and Resume button (status === 'paused') to the download row.
  Use Lucide icons. Use shadcn/ui Button. Use t('pause') / t('resume') for labels.
  ✅ After: show me the updated JSX for the action buttons.

Step 8 — i18n.
  Add "pause", "resume", "paused" to en.json only.
  ✅ After: show me the three new keys.

Step 9 — Final verification.
  Run: pnpm run typecheck
  Run: pnpm run check
  Report results. Fix any errors. Do not mark done until both pass with 0 errors.

## Stop Conditions
Stop and ask me before:
- Adding any new npm dependency.
- Modifying any file outside the Scope list above.
- Making an architecture choice not described in this prompt (e.g. a different state management approach, a different IPC pattern).
- Encountering a file structure that doesn't match the expected layout — show me what you found and ask how to proceed.
- pnpm run typecheck or pnpm run check fail with errors you cannot resolve in 2 attempts.

## Forbidden Actions
- Do NOT install new packages.
- Do NOT push to git.
- Do NOT modify the Windows implementation to use a native addon or FFI without my approval.
- Do NOT add placeholder comments or TODO markers — implement the full feature or stop and ask.
- Do NOT refactor or rename existing code beyond what is required for this feature.

## Progress Format
After each completed step output exactly:
✅ [Step N] [one sentence: what was done] — [file(s) changed]

At the very end, output a complete summary table:
| File | What changed |
|------|-------------|
| ... | ... |
```

---

## Setup Checklist Before Pasting

- [ ] Anti-Gravity IDE is open with the VidBee repo.
- [ ] Active branch is `feature/pause-resume` (run `git checkout -b feature/pause-resume`).
- [ ] SpecKit is installed and configured (spec.json points to PRD.md, TRD.md, APPFLOW.md).
- [ ] open-spec has indexed all three docs.
- [ ] `pnpm install` has been run — node_modules is populated.
- [ ] `pnpm dev` has been run at least once to confirm the dev environment is working.
- [ ] You have confirmed which file contains the `DownloadStatus` type (search for `type DownloadStatus` or `DownloadStatus =` in the codebase).

Once all boxes are checked, paste the prompt block above into Anti-Gravity and let it run Step 1 first.
