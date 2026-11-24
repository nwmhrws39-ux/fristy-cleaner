# FRISTY Cleaner

A safety-first storage cleaner for **Windows 10 and Windows 11**. It analyzes storage, finds unnecessary files and verified duplicates, and frees disk space without risking important files.

Built with Electron, React, TypeScript, Tailwind CSS, Framer Motion, Recharts, SQLite (sql.js), Node.js worker threads and electron-builder.

## Features

| Page | What it does |
|---|---|
| **Dashboard** | Total / used / available storage, potentially recoverable space, unnecessary-file count, last scan, total recovered, per-drive usage, large **Scan Now** button. |
| **Quick Scan** | Windows Temp, user Temp, application caches (DirectX/NVIDIA/AMD shader caches, INetCache, Discord, VS Code, Slack, Spotify…), browser caches (Chrome, Edge, Brave, Vivaldi, Opera, Firefox: *cache folders only*), thumbnail cache, crash dumps / WER reports, logs older than 30 days, Recycle Bin. Results by category with file count and size. Nothing is deleted automatically. |
| **Deep Scan** | Scans chosen drives and folders for large files, duplicates, empty folders, old downloads, unused installers, temporary files and large application caches. Live progress: files, folders, data read, current location, elapsed time, ETA (only shown when reliable), pause / resume / cancel. |
| **Duplicate Files** | Size grouping → hard-link elimination → partial SHA-256 (first 64 KB) → **full SHA-256** verification. Names are never used. Groups with paths, sizes, creation & modification dates, image previews, open location, recoverable space and manual selection. One copy per group is always kept. |
| **Large Files** | 100 MB / 500 MB / 1 GB / 5 GB / 10 GB / custom thresholds; sort by size, name, type, location, modification date; search; open location; safe removal. |
| **Temporary Files** | Each supported category with what it contains and the effect of cleaning it. Browser passwords, cookies, history, sessions, documents and game saves are never touched. |
| **Disk Analyzer** | All drives, interactive treemap (click to drill in), expandable folder tree, file-type distribution chart, largest folders and files. View-only. |
| **App Manager** | Installed apps from the registry (HKLM, WOW6432Node, HKCU): name, publisher, install date, size, location, search, sort. Uninstall launches the app's **official** registered uninstaller (UAC shown by Windows). Folders are never deleted manually. |
| **Cleaning History** | Date, method, removed files, recovered space, categories, every original path, errors and Recycle Bin status. Export to JSON/CSV; open the Recycle Bin to restore. |
| **Settings** | Start with Windows, minimize to tray, dark/light theme, accent color, English/Hebrew (full RTL), default scan locations, excluded folders, thresholds, notifications, scheduled scans (daily/weekly/monthly/custom), history retention, administrator restart. |

## Safety model

* **Nothing is removed without an explicit confirmation dialog.** The dialog lists recoverable space per category and the removal method.
* **Recycle Bin by default** (Electron `shell.trashItem`). Permanent deletion is a separate option that requires typing `DELETE`. If moving to the Recycle Bin fails, the item is reported as failed — FRISTY never falls back to permanent deletion.
* **Protected locations** (`electron/protection.ts`, longest-prefix rules): Windows directory, System32/SysWOW64/WinSxS, boot & recovery files (`Boot`, `EFI`, `Recovery`, `bootmgr`, `pagefile.sys`, `hiberfil.sys`…), registry hives (`NTUSER.DAT`, `UsrClass.dat`), Program Files, ProgramData, `AppData\…\Microsoft`, Store app data, `$Recycle.Bin`, `System Volume Information`, game saves (`Saved Games`, `Documents\My Games`, `AppData\LocalLow`), credentials (`.ssh`, `.gnupg`), and browser profiles — where only known cache sub-folders are ever allowed (never `Login Data`, `Cookies`, `Local Storage`, `Sessions`, `logins.json`, `key4.db`, `places.sqlite`…). Narrow allow-rules exist only for `Windows\Temp`, `Windows\Minidump`, WER report folders, `INetCache` and Explorer's thumbnail cache.
* **Personal folders** (Documents, Desktop, Pictures, Videos, Music, OneDrive) are never pre-selected; removing files from them requires an extra acknowledgement.
* **User exclusions** are never scanned nor cleaned.
* **Links are not followed**: symbolic links, junctions and other reparse points (including OneDrive online-only placeholders) are skipped by default. If following is enabled, cycles are detected and linked files are still never offered for removal.
* **Re-validation right before removal** (`electron/cleaner.ts`): protection rules (with current exclusions) are re-evaluated; the path must still exist, not be a link, resolve to itself via the OS real path (no junction anywhere in the parent chain), and have the same size and modification time as when scanned; locked files are skipped; empty folders must still be empty; at least one copy of every duplicate group must still exist.
* **Recently changed temp/cache files** (default 24 h) are never offered; age uses both modification and creation time.
* The renderer never sends file paths for deletion — only item ids of a scan held in the main process.
* **No registry cleaning, no "optimization" features, no network access.** All data (settings, scan summaries, history) is stored locally in `%APPDATA%\FRISTY Cleaner\fristy.db`.
* Scheduled scans **only scan and notify**; they never delete.
* Results are real: every number comes from the file system; sizes are logical file sizes.

## Architecture

```
electron/
  main.ts            App lifecycle, window, tray, notifications, secure IPC handlers
  preload.ts         contextBridge API (window.fristy) – no Node.js in the renderer
  protection.ts      Protection rules (pure, unit-tested)
  cleaner.ts         Re-validation + Recycle Bin / permanent removal (pure, unit-tested)
  sessions.ts        Scan workers, in-memory results, paging, estimates
  scanner/engine.ts  Walker, collectors, SHA-256 duplicate finder, disk analyzer (pure, unit-tested)
  scanner/worker.ts  Worker-thread entry (pause / resume / cancel, throttled progress)
  scanner/targets.ts Quick Scan / temp file locations
  system.ts          Drives, Recycle Bin, installed apps, official uninstallers, admin detection
  scheduler.ts       Scheduled scan timing (unit-tested)
  db.ts              SQLite (sql.js / WebAssembly, no native modules)
src/shared/          Types and API contract shared by main and renderer
src/renderer/        React UI (pages, components, i18n en/he)
tests/               Vitest tests that run the engine and cleaner against temporary directories
scripts/             Build helpers, icon generator, end-to-end test, electron-builder afterPack hook
```

Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict Content-Security-Policy, navigation and new windows blocked, every IPC call validates its sender frame, DevTools disabled in packaged builds. The app runs `asInvoker`; administrator rights are only requested when you click **Restart as administrator** (needed for `C:\Windows\Temp`).

Performance: scanning runs in a worker thread (UI stays responsive), files are `lstat`-ed in batches, only metadata is kept in memory (file contents are streamed only for hashing), the disk analyzer keeps per-folder aggregates with the top files per folder, and results are paged to the UI. Permission errors and locked files are counted and skipped.

## Requirements

* Node.js 20+ (22 recommended) and npm
* Windows 10/11 x64 to run the app; building the installer works best on Windows (see below)

## Development

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` starts Vite with hot reload and launches Electron.

```bash
npm test
```

Runs 26 unit/integration tests (protection rules, duplicate detection, deep/quick scan, pause/cancel, the full cleaning pipeline against temporary directories, scheduler).

```bash
npm run typecheck
```

```bash
npm run e2e
```

Builds the app and drives the real Electron window with Playwright against a temporary test folder: deep scan, duplicate scan, cleaning through the confirmation dialog into the Recycle Bin, history, analyzer, Hebrew/RTL and light theme screenshots. Requires Playwright (`npm i -D playwright`) and a display (on Linux use `xvfb-run`).

## Building the Windows installer

```bash
npm run dist
```

Produces `release/FRISTY-Cleaner-Setup-1.0.0.exe` — an NSIS installer (per-user, choose install directory, desktop and Start-menu shortcuts, uninstaller, user data kept on uninstall).

Other targets:

```bash
npm run dist:zip
```

Portable `release/FRISTY-Cleaner-1.0.0-win-x64.zip`.

```bash
npm run dist:dir
```

Unpacked app in `release/win-unpacked/`.

Notes:

* The executable's icon and version information are written by `scripts/after-pack.cjs` using the pure-JavaScript `resedit` library, so no Wine is needed for that step.
* Building the **NSIS installer on Linux/macOS** still requires a working Wine, because electron-builder runs the installer stub to generate the uninstaller. Build on Windows, or use the included GitHub Actions workflow (`.github/workflows/build-windows.yml`, runs on `windows-latest` on version tags or manually) which runs the tests and uploads the installer.
* The installer is unsigned. For distribution, configure code signing (`CSC_LINK` / `CSC_KEY_PASSWORD`) to avoid SmartScreen warnings.
* Regenerate icons from `build/icon.svg` with `npm run icons` (uses Playwright's Chromium).

## Usage tips

1. Run **Quick Scan** from the dashboard. Safe categories are pre-selected; review the rest.
2. Expand a category to see every file and why it is considered removable.
3. Click **Clean selected**, check the summary, keep **Move to Recycle Bin**, confirm.
4. Restore anything from the Windows Recycle Bin (Cleaning History → *Open Recycle Bin to restore*).

## License

MIT
