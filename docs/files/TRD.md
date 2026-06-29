# Technical Requirements Document
## Feature: Pause / Resume Active Downloads
**Project:** VidBee  
**Branch:** `feature/pause-resume`  
**Stack:** Electron 38 · electron-vite · React 19 · Jotai · Tailwind CSS 4 · shadcn/ui · TypeScript 5 · yt-dlp · pnpm  
**Date:** June 2026

---

## 1. Architecture Overview

VidBee uses a standard Electron three-process model:

```
Renderer (React/Jotai)
     │  IPC (ipcRenderer.invoke / ipcMain.handle)
     ▼
Main Process (Node.js)
     │  child_process.spawn
     ▼
yt-dlp subprocess  ←──── SIGSTOP / SIGCONT (macOS/Linux)
                   ←──── Job Object suspend (Windows)
```

The pause/resume feature touches all three layers: renderer UI, IPC bridge, and main-process subprocess management.

---

## 2. Files to Modify

| File | Change |
|------|--------|
| `apps/desktop/src/main/download-manager.ts` (or equivalent) | Add `pauseDownload(id)` and `resumeDownload(id)` methods |
| `apps/desktop/src/main/ipc-handlers.ts` | Register `download:pause` and `download:resume` IPC handlers |
| `apps/desktop/src/preload/index.ts` | Expose `pauseDownload` and `resumeDownload` on `window.api` |
| `apps/desktop/src/renderer/src/hooks/useDownloads.ts` (or Jotai atom file) | Add `paused` to `DownloadStatus` union; add pause/resume action dispatchers |
| `apps/desktop/src/renderer/src/components/DownloadItem.tsx` (or download row component) | Render Pause / Resume button based on status |
| `apps/desktop/src/renderer/src/locales/en.json` | Add `"pause"`, `"resume"`, `"paused"` i18n keys |

> **Note:** Exact file names should be verified after cloning. The structure above follows the CONTRIBUTING.md layout.

---

## 3. Main Process: Subprocess Control

### 3.1 Tracking Active Processes

The download manager must maintain a map of active subprocesses:

```typescript
// apps/desktop/src/main/download-manager.ts

const activeProcesses = new Map<string, ChildProcess>();

// When spawning yt-dlp:
const proc = spawn('yt-dlp', [...args]);
activeProcesses.set(downloadId, proc);

// On completion/cancel:
activeProcesses.delete(downloadId);
```

### 3.2 Platform-Safe Pause / Resume

```typescript
// apps/desktop/src/main/download-manager.ts

import { platform } from 'node:os';

export function pauseDownload(id: string): void {
  const proc = activeProcesses.get(id);
  if (!proc || !proc.pid) return;

  if (platform() === 'win32') {
    // Windows: use ntsuspend or the built-in NtSuspendProcess via a helper
    // Option A: spawn a tiny helper exe (bundled in resources/)
    // Option B: use node-ffi-napi — NOT recommended (adds native dep)
    // Recommended: use `taskkill /PID <pid> /T` is too aggressive (kills)
    // Use node-windows-process-controller if maintainers approve new dep
    // For v1: emit a PAUSE marker and re-spawn on resume (safe fallback)
    proc.kill('SIGTERM'); // graceful stop — yt-dlp writes partial file
    updateDownloadState(id, 'paused');
  } else {
    // macOS + Linux: POSIX signals
    proc.kill('SIGSTOP');
    updateDownloadState(id, 'paused');
  }
}

export function resumeDownload(id: string, downloadArgs: string[]): void {
  const existing = activeProcesses.get(id);

  if (platform() !== 'win32' && existing?.pid) {
    // Un-freeze the process
    existing.kill('SIGCONT');
    updateDownloadState(id, 'downloading');
  } else {
    // Windows fallback: re-spawn yt-dlp with --continue
    // Partial file already exists at the same path, yt-dlp resumes automatically
    const proc = spawn('yt-dlp', [...downloadArgs, '--continue']);
    activeProcesses.set(id, proc);
    attachProgressListeners(id, proc);
    updateDownloadState(id, 'downloading');
  }
}
```

### 3.3 yt-dlp `--continue` Flag

When re-spawning (Windows fallback or future cross-platform approach), pass `--continue` to yt-dlp. This instructs yt-dlp to skip already-downloaded bytes and append to the partial file:

```
yt-dlp --continue --output "%(title)s.%(ext)s" <url>
```

yt-dlp reads the partial `.part` file and issues HTTP Range requests from the last byte offset.

---

## 4. IPC Layer

### 4.1 Main Process — Handler Registration

```typescript
// apps/desktop/src/main/ipc-handlers.ts

ipcMain.handle('download:pause', (_event, id: string) => {
  pauseDownload(id);
});

ipcMain.handle('download:resume', (_event, id: string) => {
  resumeDownload(id, getDownloadArgs(id)); // retrieve stored args
});
```

### 4.2 Preload — Context Bridge

```typescript
// apps/desktop/src/preload/index.ts

contextBridge.exposeInMainWorld('api', {
  // ...existing methods...
  pauseDownload: (id: string) => ipcRenderer.invoke('download:pause', id),
  resumeDownload: (id: string) => ipcRenderer.invoke('download:resume', id),
});
```

---

## 5. State Model

### 5.1 Type Extension

```typescript
// Wherever DownloadStatus is defined (likely hooks/useDownloads.ts or a types file)

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'paused'          // ← NEW
  | 'completed'
  | 'error'
  | 'cancelled';
```

### 5.2 Jotai Atom Update

```typescript
// Pseudo-code — adapt to existing atom shape

const pauseDownloadAtom = atom(null, (get, set, id: string) => {
  set(downloadsAtom, prev =>
    prev.map(d => d.id === id ? { ...d, status: 'paused' } : d)
  );
  window.api.pauseDownload(id);
});

const resumeDownloadAtom = atom(null, (get, set, id: string) => {
  set(downloadsAtom, prev =>
    prev.map(d => d.id === id ? { ...d, status: 'downloading' } : d)
  );
  window.api.resumeDownload(id);
});
```

---

## 6. Renderer UI

### 6.1 Pause / Resume Button Logic

```tsx
// apps/desktop/src/renderer/src/components/DownloadItem.tsx

import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

// Inside the download row component:
const { t } = useTranslation();

{download.status === 'downloading' && (
  <Button
    variant="ghost"
    size="icon"
    onClick={() => pauseDownload(download.id)}
    aria-label={t('pause')}
  >
    <Pause className="h-4 w-4" />
  </Button>
)}

{download.status === 'paused' && (
  <Button
    variant="ghost"
    size="icon"
    onClick={() => resumeDownload(download.id)}
    aria-label={t('resume')}
  >
    <Play className="h-4 w-4" />
  </Button>
)}
```

### 6.2 Status Badge

```tsx
// Extend the existing status badge mapping

const statusLabel: Record<DownloadStatus, string> = {
  queued: t('queued'),
  downloading: t('downloading'),
  paused: t('paused'),       // ← NEW
  completed: t('completed'),
  error: t('error'),
  cancelled: t('cancelled'),
};
```

---

## 7. i18n Keys

Add to `apps/desktop/src/renderer/src/locales/en.json`:

```json
{
  "pause": "Pause",
  "resume": "Resume",
  "paused": "Paused"
}
```

---

## 8. Cross-Platform Matrix

| Platform | Pause Method | Resume Method | Notes |
|----------|-------------|---------------|-------|
| macOS | `SIGSTOP` | `SIGCONT` | Native POSIX, zero latency |
| Linux | `SIGSTOP` | `SIGCONT` | Native POSIX, zero latency |
| Windows | `SIGTERM` + re-spawn | `spawn --continue` | SIGSTOP not available; partial file preserved by yt-dlp |

---

## 9. Testing Checklist

- [ ] macOS: Pause a 500MB YouTube download at ~40% → process freezes, network drops.
- [ ] macOS: Resume from paused → continues from ~40%, not 0%.
- [ ] Linux: Same as macOS tests.
- [ ] Windows: Pause → yt-dlp exits, `.part` file retained → Resume → new yt-dlp process appends from last offset.
- [ ] Cancel a paused download → partial file cleaned up, state transitions to `cancelled`.
- [ ] Two concurrent downloads — pause one, verify the other continues unaffected.
- [ ] `pnpm run typecheck` → 0 errors.
- [ ] `pnpm run check` → 0 Biome errors.

---

## 10. Dependencies

No new npm packages required for macOS/Linux. Windows may require a bundled helper if SIGTERM+re-spawn approach proves insufficient; discuss with maintainers before adding.

---

## 11. Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Windows SIGSTOP unavailable | Certain | SIGTERM + re-spawn with `--continue` |
| yt-dlp partial file corruption on abrupt SIGTERM | Low | yt-dlp writes `.part` files atomically; `--continue` is the intended recovery mechanism |
| Progress bar jumping backwards on resume (Windows re-spawn) | Medium | Read byte offset from `.part` file size before re-spawning to seed progress |
| Race condition: user clicks Pause twice | Low | Debounce button or disable it immediately on first click |
