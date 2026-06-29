# Product Requirements Document
## Feature: Pause / Resume Active Downloads
**Project:** VidBee — Open Source Video Downloader  
**Repo:** https://github.com/nexmoe/VidBee  
**Branch:** `feature/pause-resume`  
**Status:** Draft · Open Source Contribution  
**Date:** June 2026

---

## 1. Problem Statement

VidBee currently lets users cancel or retry downloads, but provides no way to temporarily suspend an active download and resume it later. Users who need to free bandwidth for other tasks, switch networks, or manage system resources are forced to either cancel (losing all progress) or let the download consume resources indefinitely. This is a gap compared to most native download managers.

---

## 2. Goals

- Allow users to pause any in-progress download without losing download progress.
- Allow users to resume a paused download from where it stopped.
- Surface clear, real-time visual feedback about paused state across all relevant UI surfaces.
- Keep the implementation consistent with VidBee's existing Electron + yt-dlp architecture; no new external dependencies.

---

## 3. Non-Goals

- Pause/resume for queued (not yet started) downloads — out of scope.
- Pause all downloads simultaneously (bulk pause) — out of scope for this PR.
- Network bandwidth throttling — separate feature.
- Persistence of paused state across app restarts — stretch goal, not required in v1.

---

## 4. User Stories

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-01 | As a user downloading a large video, I want to pause the download so I can free up bandwidth without losing progress. | Pause button visible on active download row; clicking it halts yt-dlp process; progress bar freezes at current %. |
| US-02 | As a user who paused a download, I want to resume it from where I left off. | Resume button replaces Pause on paused row; clicking restarts yt-dlp with `--continue` flag; progress resumes from saved byte offset. |
| US-03 | As a user, I want to immediately see which downloads are paused vs active via a visual indicator. | Paused rows display a distinct icon/badge ("Paused") differentiated from "Downloading" and "Error" states. |
| US-04 | As a user, I want the Pause button to be accessible without opening a context menu. | Pause/Resume button is a primary inline action — same visual level as Cancel button. |

---

## 5. Functional Requirements

### 5.1 Pause Behaviour
- **FR-01:** A "Pause" button MUST appear on every download row in the `Downloading` state.
- **FR-02:** Clicking Pause MUST send a signal to the yt-dlp subprocess to suspend (`SIGSTOP` on macOS/Linux; suspend via Windows Job Object on Windows).
- **FR-03:** Download state MUST transition to `Paused` immediately; the progress bar MUST freeze.
- **FR-04:** Paused downloads MUST retain their partial file on disk.

### 5.2 Resume Behaviour
- **FR-05:** A "Resume" button MUST appear on every row in the `Paused` state, replacing the Pause button.
- **FR-06:** Clicking Resume MUST restart the yt-dlp process with `--continue` (partial file append) from the existing partial download path.
- **FR-07:** Download state MUST transition back to `Downloading`; the progress bar MUST animate from the last known byte offset.

### 5.3 State Model Extension
The existing download state must be extended:

```
Queued → Downloading → [Paused ↔ Downloading] → Completed
                                                  ↓
                                               Error / Cancelled
```

New states to add: `paused`

### 5.4 IPC Contract (Main ↔ Renderer)
Two new IPC channels required:

| Channel | Direction | Payload |
|---------|-----------|---------|
| `download:pause` | Renderer → Main | `{ id: string }` |
| `download:resume` | Renderer → Main | `{ id: string }` |

---

## 6. Non-Functional Requirements

- **NFR-01 Performance:** Pause/Resume must execute within 300ms of button click.
- **NFR-02 Reliability:** Partial files MUST NOT be corrupted on pause; yt-dlp's native `--continue` handles byte-range safety.
- **NFR-03 Cross-platform:** MUST work on Windows, macOS, and Linux (the three Electron build targets).
- **NFR-04 i18n:** All new UI strings MUST be added to `en.json`; no hardcoded English strings in JSX.
- **NFR-05 Code style:** MUST pass `pnpm run check` (Biome linting + formatting) before PR submission.

---

## 7. Out of Scope

- Batch pause/resume.
- Pause state persistence after app restart.
- Bandwidth control or scheduling.

---

## 8. Success Metrics

- [ ] Pause button visible on active download row without regression to existing Cancel/Retry actions.
- [ ] Pausing halts yt-dlp subprocess; CPU/network usage drops to zero for that download.
- [ ] Resume re-starts yt-dlp from partial file offset (no re-download from 0%).
- [ ] All new strings present in `en.json`.
- [ ] `pnpm run check` passes with zero errors.
- [ ] `pnpm run typecheck` passes with zero TypeScript errors.

---

## 9. Open Questions

1. Should paused downloads block other queued downloads from starting? (Current queue behaviour TBD with maintainers.)
2. Should a paused download auto-resume if the user closes and reopens the app? (v2 stretch goal.)
3. What is the max number of concurrent downloads VidBee supports — should pause free a concurrent slot?
