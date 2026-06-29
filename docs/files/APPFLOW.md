# AppFlow Document
## Feature: Pause / Resume Active Downloads
**Project:** VidBee  
**Branch:** `feature/pause-resume`  
**Date:** June 2026

---

## 1. End-to-End Contributor Workflow

```
Fork nexmoe/VidBee on GitHub
         │
         ▼
git clone https://github.com/<YOU>/VidBee
cd VidBee
         │
         ▼
pnpm install
         │
         ▼
pnpm dev  ──────────────────────► Electron window opens
         │
         ▼
Explore codebase
  └── apps/desktop/src/main/          (IPC, download manager)
  └── apps/desktop/src/preload/       (context bridge)
  └── apps/desktop/src/renderer/src/  (React UI, atoms, components)
         │
         ▼
git checkout -b feature/pause-resume
         │
         ▼
[IMPLEMENT — see Implementation Flow below]
         │
         ▼
pnpm run typecheck  →  0 errors
pnpm run check      →  0 Biome errors
         │
         ▼
Test manually (see Test Flow below)
         │
         ▼
git add -p   (stage only relevant hunks)
git commit -m "feat: add pause/resume for active downloads"
git push origin feature/pause-resume
         │
         ▼
Open Pull Request on GitHub
  └── Title: "feat: Add Pause/Resume button for active downloads"
  └── Body: link to issue, describe what changed, test evidence
         │
         ▼
Maintainer review → address feedback → merge
```

---

## 2. Implementation Flow (Step-by-Step)

### Step 1 — Extend the Type System
**File:** `apps/desktop/src/renderer/src/` (locate `DownloadStatus` type)

```
Add 'paused' to DownloadStatus union
Run: pnpm run typecheck  →  fix all resulting type errors
```

### Step 2 — Main Process: Track Subprocesses
**File:** `apps/desktop/src/main/download-manager.ts`

```
Add: Map<string, ChildProcess> to track active yt-dlp processes
Add: pauseDownload(id) function
Add: resumeDownload(id, args) function
Add: Store original yt-dlp args per download (needed for Windows re-spawn)
```

### Step 3 — IPC Handlers
**File:** `apps/desktop/src/main/ipc-handlers.ts`

```
Register: ipcMain.handle('download:pause', ...)
Register: ipcMain.handle('download:resume', ...)
```

### Step 4 — Preload Context Bridge
**File:** `apps/desktop/src/preload/index.ts`

```
Expose: pauseDownload(id) via contextBridge
Expose: resumeDownload(id) via contextBridge
```

### Step 5 — Renderer State (Jotai)
**File:** `apps/desktop/src/renderer/src/hooks/` or atoms file

```
Add: pauseDownloadAtom action
Add: resumeDownloadAtom action
Update: status display logic to handle 'paused'
```

### Step 6 — UI Component
**File:** `apps/desktop/src/renderer/src/components/` (download row / item)

```
Render: <Pause> icon button when status === 'downloading'
Render: <Play> icon button when status === 'paused'
Use: Lucide icons (already a project dependency)
Use: shadcn/ui Button (already a project dependency)
```

### Step 7 — i18n Strings
**File:** `apps/desktop/src/renderer/src/locales/en.json`

```json
"pause": "Pause"
"resume": "Resume"
"paused": "Paused"
```

### Step 8 — Final Checks

```
pnpm run typecheck
pnpm run check
pnpm dev  →  manual test (see Test Flow)
```

---

## 3. Download State Machine

```
┌─────────┐
│ Queued  │
└────┬────┘
     │  starts
     ▼
┌────────────┐  user clicks Pause  ┌────────┐
│Downloading │────────────────────►│ Paused │
│            │◄────────────────────│        │
└─────┬──────┘  user clicks Resume └────────┘
      │ finishes
      ▼
┌───────────┐
│ Completed │
└───────────┘

(Error and Cancelled branches exist from Downloading; unchanged)
```

---

## 4. IPC Message Flow

```
User clicks "Pause"
      │
      ▼
Renderer: pauseDownload(id)
      │  ipcRenderer.invoke('download:pause', id)
      ▼
Preload: contextBridge passes through
      │
      ▼
Main: ipcMain.handle('download:pause')
      │
      ▼
download-manager: proc.kill('SIGSTOP')  [macOS/Linux]
                  proc.kill('SIGTERM')  [Windows]
      │
      ▼
Atom update: status → 'paused'
      │
      ▼
UI re-renders: Pause icon → Play icon
               Progress bar freezes
               Status badge → "Paused"
```

```
User clicks "Resume"
      │
      ▼
Renderer: resumeDownload(id)
      │  ipcRenderer.invoke('download:resume', id)
      ▼
Main: ipcMain.handle('download:resume')
      │
      ▼
[macOS/Linux] proc.kill('SIGCONT')
[Windows]     spawn('yt-dlp', [...args, '--continue'])
      │
      ▼
Atom update: status → 'downloading'
      │
      ▼
UI re-renders: Play icon → Pause icon
               Progress bar animates from last %
               Status badge → "Downloading"
```

---

## 5. Manual Test Flows

### Test A — Happy Path (macOS/Linux)
1. Start a download of a large video (e.g. a 15-minute YouTube video).
2. At ~20% progress, click **Pause**.
3. Verify: progress bar freezes, status shows "Paused", Pause icon becomes Play icon.
4. Verify: network monitor shows zero traffic for that download.
5. Click **Resume**.
6. Verify: download continues from ~20%, not 0%.
7. Let it complete → status transitions to "Completed".

### Test B — Windows Fallback
1. Same as Test A but on Windows.
2. On Pause: yt-dlp process exits, `.part` file remains on disk.
3. On Resume: new yt-dlp spawns with `--continue`, appends to `.part` file.
4. Progress continues from approximately same offset (may show brief jump).

### Test C — Cancel a Paused Download
1. Pause a download.
2. Click **Cancel** on the paused download.
3. Verify: state moves to "Cancelled", partial file is cleaned up (if VidBee cleans partial files on cancel).

### Test D — Concurrent Downloads
1. Start two downloads simultaneously.
2. Pause download A.
3. Verify: download B continues at full speed, unaffected.
4. Resume download A.
5. Verify: both resume concurrent downloads.

### Test E — Edge Cases
- Click Pause when download is at 99% → should pause, not complete.
- Click Pause and immediately Resume → should not corrupt state.
- Close and reopen app with a paused download → download shows as "paused" if state is persisted, OR as "cancelled" if not (document which behaviour is implemented).

---

## 6. GitHub Issue Template

Use this when creating the issue on nexmoe/VidBee:

```markdown
## Feature Request: Pause/Resume Button for Active Downloads

**Is your feature request related to a problem?**
When downloading large videos, there's no way to temporarily pause a download without cancelling it entirely. Users lose all progress if they need to free bandwidth.

**Describe the solution you'd like**
Add Pause and Resume buttons to active download rows in the download queue. 

- Pause: suspends the yt-dlp subprocess, freezes progress, shows "Paused" state.
- Resume: restores the subprocess (or re-spawns with `--continue`), continuing from the last byte offset.

**Additional context**
The README mentions "One-click pause/resume/retry" as a feature, suggesting this is intended but not yet implemented. I'd like to contribute this as a PR.

**I'm willing to implement this:** Yes — I have a draft plan (PRD + TRD) ready and will open a PR from `feature/pause-resume`.
```

---

## 7. Pull Request Template

```markdown
## feat: Add Pause/Resume button for active downloads

Closes #[ISSUE_NUMBER]

### What changed
- Extended `DownloadStatus` type with `'paused'` state.
- Added `pauseDownload()` and `resumeDownload()` to the download manager (SIGSTOP/SIGCONT on POSIX; SIGTERM + re-spawn with `--continue` on Windows).
- Registered `download:pause` and `download:resume` IPC handlers.
- Exposed `pauseDownload` / `resumeDownload` through preload context bridge.
- Added Pause/Resume button to download row UI using Lucide icons + shadcn/ui.
- Added `pause`, `resume`, `paused` keys to `en.json`.

### Testing
- Tested on macOS: SIGSTOP/SIGCONT confirmed working, progress resumes from correct offset.
- Tested on Windows: SIGTERM + re-spawn with `--continue` confirmed working.
- `pnpm run typecheck` → 0 errors.
- `pnpm run check` → 0 errors.

### Screenshots
[Attach before/after screenshots of the download queue UI]
```

---

## 8. Anti-Gravity IDE Setup (SpecKit + open-spec)

### Before Opening in Anti-Gravity
1. Clone your fork locally.
2. Run `pnpm install` to hydrate `node_modules`.
3. Confirm `pnpm dev` opens the Electron window successfully.
4. Check out the feature branch: `git checkout -b feature/pause-resume`.

### SpecKit Configuration
Create a `spec.json` (or `.speckit.json`) at the repo root:

```json
{
  "project": "VidBee",
  "feature": "pause-resume",
  "prd": "./docs/PRD.md",
  "trd": "./docs/TRD.md",
  "appflow": "./docs/APPFLOW.md",
  "entryFiles": [
    "apps/desktop/src/main/download-manager.ts",
    "apps/desktop/src/main/ipc-handlers.ts",
    "apps/desktop/src/preload/index.ts",
    "apps/desktop/src/renderer/src/hooks/useDownloads.ts",
    "apps/desktop/src/renderer/src/locales/en.json"
  ],
  "testCommand": "pnpm run typecheck && pnpm run check"
}
```

### open-spec Registration
Point open-spec at the three docs in this package:
- PRD: `./docs/PRD.md`
- TRD: `./docs/TRD.md`
- AppFlow: `./docs/APPFLOW.md`

Anti-Gravity will index these as the ground truth for the feature scope.
