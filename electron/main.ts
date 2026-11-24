/**
 * FRISTY Cleaner - Electron main process.
 *
 * Security model:
 *  - renderer runs sandboxed with contextIsolation and without Node integration,
 *  - the renderer can only call the narrow API in preload.ts; every IPC call checks its sender,
 *  - file paths to remove are never taken from the renderer: it sends item ids of a scan session,
 *  - nothing is ever sent over the network.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from './db';
import { buildProtectionConfig, type ProtectionRule } from './protection';
import { ScanManager, type Session } from './sessions';
import { defaultDetect, type EngineTask } from './scanner/engine';
import { buildQuickTargets } from './scanner/targets';
import { executeClean } from './cleaner';
import { Scheduler } from './scheduler';
import * as sys from './system';
import { DEFAULT_SETTINGS, PERMANENT_CONFIRM_PHRASE } from '../src/shared/defaults';
import type {
  CategoryInfo, CleanProgress, CleanRequest, CleanResult, DashboardStats, ItemQuery, ScanKind, ScanRequest, ScanSummary, Settings,
} from '../src/shared/types';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const APP_ID = 'com.fristy.cleaner';

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId(APP_ID);

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: Store;
let settings: Settings = DEFAULT_SETTINGS;
let quitting = false;
let cleaning = false;
let scheduler: Scheduler;

/* ---------------- Paths & assets ---------------- */

function assetPath(...p: string[]) {
  return app.isPackaged ? path.join(process.resourcesPath, 'assets', ...p) : path.join(__dirname, '..', 'build', ...p);
}

function workerPath() {
  const p = path.join(__dirname, 'scanner.worker.js');
  // The worker is unpacked from the asar archive (see electron-builder config).
  return p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

function knownFolders(): Record<string, string> {
  const out: Record<string, string> = { home: os.homedir() };
  for (const k of ['documents', 'desktop', 'pictures', 'videos', 'music', 'downloads'] as const) {
    try {
      out[k] = app.getPath(k);
    } catch {
      /* not available */
    }
  }
  return out;
}

/* ---------------- Settings ---------------- */

function loadSettings(): Settings {
  const saved = store.getKV<Partial<Settings>>('settings') ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(saved.notifications ?? {}) },
    schedule: { ...DEFAULT_SETTINGS.schedule, ...(saved.schedule ?? {}) },
  };
}

function sanitizeSettings(patch: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = { ...patch };
  if (out.language && !['en', 'he'].includes(out.language)) delete out.language;
  if (out.theme && !['dark', 'light'].includes(out.theme)) delete out.theme;
  if (out.accent && !/^#[0-9a-f]{6}$/i.test(out.accent)) delete out.accent;
  const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);
  if ('largeFileMinMB' in out) out.largeFileMinMB = num(out.largeFileMinMB, 1, 1024 * 1024) ?? settings.largeFileMinMB;
  if ('duplicateMinKB' in out) out.duplicateMinKB = num(out.duplicateMinKB, 0, 1024 * 1024 * 10) ?? settings.duplicateMinKB;
  if ('historyRetentionDays' in out) out.historyRetentionDays = num(out.historyRetentionDays, 0, 3650) ?? settings.historyRetentionDays;
  if ('skipRecentHours' in out) out.skipRecentHours = num(out.skipRecentHours, 0, 24 * 30) ?? settings.skipRecentHours;
  for (const k of ['excludedFolders', 'defaultScanLocations'] as const) {
    if (k in out) out[k] = (Array.isArray(out[k]) ? out[k]! : []).filter((x) => typeof x === 'string' && path.isAbsolute(x));
  }
  return out;
}

function applySystemSettings() {
  if (app.isPackaged && process.platform !== 'linux') {
    app.setLoginItemSettings({ openAtLogin: settings.startWithWindows, args: ['--hidden'] });
  }
  if (settings.minimizeToTray || settings.schedule.enabled) createTray();
  else {
    tray?.destroy();
    tray = null;
  }
}

/* ---------------- Protection & tasks ---------------- */

function protection() {
  const kf = knownFolders();
  const extra: ProtectionRule[] = ['documents', 'desktop', 'pictures', 'videos', 'music']
    .filter((k) => kf[k])
    .map((k) => ({ prefix: kf[k], verdict: 'personal' as const, reason: 'protect.personal' }));
  return buildProtectionConfig({ windows: sys.isWindows, env: process.env, exclusions: settings.excludedFolders, extraRules: extra });
}

function defaultRoots(): string[] {
  if (settings.defaultScanLocations.length) return settings.defaultScanLocations;
  return [sys.isWindows ? `${process.env.SystemDrive || 'C:'}\\` : os.homedir()];
}

async function buildTask(req: ScanRequest): Promise<Omit<EngineTask, 'scanId'>> {
  const kf = knownFolders();
  const roots = req.kind === 'quick' ? [] : (req.roots?.filter((r) => typeof r === 'string' && path.isAbsolute(r)) ?? []);
  const useRoots = req.kind === 'quick' ? [] : roots.length ? roots : defaultRoots();
  let expectedBytes: number | null = null;
  if (useRoots.length && useRoots.every((r) => path.parse(path.resolve(r)).root.toLowerCase() === path.resolve(r).toLowerCase())) {
    const drives = await sys.listDrives().catch(() => []);
    const set = new Set(useRoots.map((r) => path.resolve(r).toLowerCase()));
    expectedBytes = drives.filter((d) => set.has(d.root.toLowerCase())).reduce((a, d) => a + d.used, 0) || null;
  }
  let targets = req.kind === 'quick' ? buildQuickTargets({ windows: sys.isWindows, env: process.env, skipRecentHours: settings.skipRecentHours }) : undefined;
  if (targets && req.categories?.length) targets = targets.filter((t) => req.categories!.includes(t.categoryId));
  const env = process.env;
  return {
    kind: req.kind,
    roots: useRoots,
    targets,
    detect: defaultDetect(req.kind, req.detect),
    largeMinBytes: req.largeMinBytes ?? settings.largeFileMinMB * 1024 * 1024,
    dupMinBytes: Math.max(1, req.dupMinBytes ?? settings.duplicateMinKB * 1024),
    cacheMinBytes: 100 * 1024 * 1024,
    protection: protection(),
    followLinks: settings.followLinks,
    skipRecentHours: settings.skipRecentHours,
    oldDownloadDays: settings.oldDownloadDays,
    installerDays: settings.installerDays,
    downloadsDirs: [kf.downloads].filter(Boolean),
    noEmptyFolderRoots: [env.APPDATA, env.LOCALAPPDATA, env.ProgramData, path.join(os.homedir(), 'AppData'), path.join(os.homedir(), '.config'), path.join(os.homedir(), '.local')].filter((x): x is string => !!x),
    cloudRoots: [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial].filter((x): x is string => !!x),
    skipCloudHashing: settings.skipCloudFilesForHashing,
    expectedBytes,
    ageUsesCreationTime: true,
    now: Date.now(),
  };
}

async function recycleCategory(): Promise<CategoryInfo[]> {
  if (!sys.isWindows) return [];
  const info = await sys.recycleBinInfo();
  return [{ id: 'recycleBin', count: info.count, bytes: info.bytes, risk: 'caution', autoSelect: false, locations: ['Recycle Bin'], inaccessible: info.supported ? 0 : 1 }];
}

/* ---------------- Scanning ---------------- */

const manager = new ScanManager(workerPath(), {
  progress: (p) => win?.webContents.send('scan:progress', p),
  complete: (s) => {
    if (!s.cancelled && !s.errorMessage) store.saveScan(s);
    win?.webContents.send('scan:complete', s);
    if (!s.cancelled && !s.errorMessage) maybeNotifyScan(s);
  },
});

async function startScan(req: ScanRequest) {
  const kinds: ScanKind[] = ['quick', 'deep', 'duplicates', 'large', 'analyze'];
  if (!kinds.includes(req.kind)) throw new Error('Unknown scan type');
  const task = await buildTask(req);
  const wantsRecycle = req.kind === 'quick' && (!req.categories?.length || req.categories.includes('recycleBin'));
  return manager.start(req, task, wantsRecycle ? recycleCategory() : Promise.resolve([]));
}

function maybeNotifyScan(s: ScanSummary) {
  if (!Notification.isSupported()) return;
  const he = settings.language === 'he';
  const gb = (b: number) => (b / 1024 ** 3 >= 1 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(0)} MB`);
  if (s.scheduled) {
    if (!settings.notifications.scheduledFindings || s.totalBytes < settings.notifications.minFindingsMB * 1024 * 1024) return;
    const n = new Notification({
      title: he ? 'FRISTY Cleaner – סריקה מתוזמנת' : 'FRISTY Cleaner – Scheduled scan',
      body: he
        ? `נמצאו ${gb(s.totalBytes)} שניתן לפנות. דבר לא נמחק – לחץ לבדיקה.`
        : `${gb(s.totalBytes)} of potentially removable files found. Nothing was deleted – click to review.`,
      icon: assetPath('icon.png'),
    });
    n.on('click', () => showWindow('/quick'));
    n.show();
  } else if (settings.notifications.scanComplete && win && !win.isFocused()) {
    const n = new Notification({
      title: he ? 'הסריקה הושלמה' : 'Scan complete',
      body: he ? `נמצאו ${s.totalCount.toLocaleString()} פריטים (${gb(s.totalBytes)}).` : `Found ${s.totalCount.toLocaleString()} items (${gb(s.totalBytes)}).`,
      icon: assetPath('icon.png'),
    });
    n.on('click', () => showWindow());
    n.show();
  }
}

/* ---------------- Cleaning ---------------- */

async function runClean(req: CleanRequest): Promise<CleanResult> {
  if (cleaning) throw new Error('A cleaning operation is already running.');
  if (req.confirmed !== true) throw new Error('Cleaning requires confirmation.');
  if (req.mode !== 'trash' && req.mode !== 'permanent') throw new Error('Invalid mode');
  if (req.mode === 'permanent' && req.permanentConfirmation !== PERMANENT_CONFIRM_PHRASE) throw new Error('Permanent deletion was not confirmed.');
  const session = manager.sessions.get(req.scanId);
  if (!session) throw new Error('These scan results are no longer available. Please scan again.');
  if (!Array.isArray(req.itemIds) || req.itemIds.some((x) => typeof x !== 'number')) throw new Error('Invalid selection');

  const selected = req.itemIds.map((id) => session.byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
  cleaning = true;
  const started = Date.now();
  try {
    const out = await executeClean(selected, session.byId, session.groups, req.mode, {
      protection: protection(),
      trash: (p) => shell.trashItem(p),
      onProgress: (p: CleanProgress) => win?.webContents.send('clean:progress', p),
    });
    const categories = [...new Set(out.results.map((r) => r.categoryId))];
    const historyId = store.addCleaning(
      { date: Date.now(), mode: req.mode, removed: out.removed, failed: out.failed, skipped: out.skipped, bytes: out.bytes, categories, source: session.summary.kind },
      out.results,
    );
    store.pruneHistory(settings.historyRetentionDays);
    session.removePaths(new Set(out.results.filter((r) => r.status === 'recycled' || r.status === 'deleted').map((r) => r.path)));
    store.saveScan(session.summary);
    return {
      historyId, mode: req.mode, removed: out.removed, failed: out.failed, skipped: out.skipped, bytesRecovered: out.bytes,
      durationMs: Date.now() - started, issues: out.results.filter((r) => r.status === 'failed' || r.status === 'skipped').slice(0, 500),
    };
  } finally {
    cleaning = false;
  }
}

/* ---------------- Window & tray ---------------- */

function showWindow(route?: string) {
  if (!win) createWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (route) win.webContents.send('nav', route);
}

function createTray() {
  if (tray) return;
  const img = nativeImage.createFromPath(assetPath('icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('FRISTY Cleaner');
  const he = () => settings.language === 'he';
  const rebuild = () =>
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: he() ? 'פתח את FRISTY Cleaner' : 'Open FRISTY Cleaner', click: () => showWindow() },
        { label: he() ? 'סריקה מהירה' : 'Quick Scan', click: () => showWindow('/quick?autostart=1') },
        { type: 'separator' },
        { label: he() ? 'יציאה' : 'Quit', click: () => { quitting = true; app.quit(); } },
      ]),
    );
  rebuild();
  tray.on('click', () => showWindow());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: settings.theme === 'light' ? '#f4f3f8' : '#0a0a0f',
    title: 'FRISTY Cleaner',
    icon: assetPath('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (DEV_URL ? !url.startsWith(DEV_URL) : !url.startsWith('file://')) e.preventDefault();
  });
  win.on('maximize', () => win?.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win?.webContents.send('window:maximized', false));
  win.on('close', (e) => {
    if (!quitting && settings.minimizeToTray && tray) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on('closed', () => (win = null));
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win?.show();
  });
  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

/* ---------------- IPC ---------------- */

function validSender(e: IpcMainInvokeEvent) {
  if (!win || e.sender !== win.webContents) return false;
  const url = e.senderFrame?.url ?? '';
  return DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://');
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!validSender(e)) throw new Error('Blocked IPC call from untrusted sender');
    return fn(...(args as A));
  });
}

const str = (v: unknown) => {
  if (typeof v !== 'string') throw new Error('Invalid argument');
  return v;
};

function session(id: unknown): Session | undefined {
  return manager.sessions.get(str(id));
}

function registerIpc() {
  ipcMain.on('window:minimize', (e) => e.sender === win?.webContents && win?.minimize());
  ipcMain.on('window:toggleMaximize', (e) => {
    if (e.sender !== win?.webContents) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', (e) => e.sender === win?.webContents && win?.close());

  handle('system:info', async () => ({
    platform: process.platform, isWindows: sys.isWindows, isAdmin: await sys.isAdmin(), version: app.getVersion(), home: os.homedir(), knownFolders: knownFolders(),
  }));
  handle('system:drives', () => sys.listDrives());
  handle('system:pickFolders', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'] });
    return r.canceled ? null : r.filePaths;
  });
  handle('system:showInFolder', async (p: unknown) => {
    const s = str(p);
    if (path.isAbsolute(s) && fs.existsSync(s)) shell.showItemInFolder(s);
  });
  handle('system:openRecycleBin', () => sys.openRecycleBin());
  handle('system:relaunchAsAdmin', async () => {
    const args = app.isPackaged ? [] : [app.getAppPath()];
    // Release the single-instance lock first so the elevated instance can start.
    app.releaseSingleInstanceLock();
    const ok = await sys.relaunchElevated(process.execPath, args);
    if (ok) {
      quitting = true;
      app.quit();
    } else app.requestSingleInstanceLock();
    return ok;
  });

  handle('settings:get', () => settings);
  handle('settings:set', (patch: unknown) => {
    if (!patch || typeof patch !== 'object') throw new Error('Invalid settings');
    const prevSchedule = JSON.stringify(settings.schedule);
    settings = { ...settings, ...sanitizeSettings(patch as Partial<Settings>) };
    store.setKV('settings', settings);
    if (JSON.stringify(settings.schedule) !== prevSchedule) store.setKV('scheduler.anchor', Date.now());
    applySystemSettings();
    store.pruneHistory(settings.historyRetentionDays);
    return settings;
  });

  handle('scan:start', async (req: unknown) => (await startScan(req as ScanRequest)).scanId);
  handle('scan:pause', (id: unknown) => manager.control(str(id), 'pause'));
  handle('scan:resume', (id: unknown) => manager.control(str(id), 'resume'));
  handle('scan:cancel', (id: unknown) => manager.control(str(id), 'cancel'));
  handle('scan:active', () => manager.activeProgress());
  handle('scan:latest', (kind: unknown) => {
    const live = [...manager.sessions.values()].filter((s) => s.summary.kind === kind).pop();
    return live?.summary ?? store.latestScan(str(kind) as ScanKind);
  });
  handle('scan:summary', (id: unknown) => session(id)?.summary ?? null);
  handle('scan:items', (id: unknown, q: unknown) => {
    const s = session(id);
    const query = q as ItemQuery;
    if (!s) return { items: [], total: 0, totalBytes: 0 };
    return s.query({ ...query, offset: Math.max(0, query.offset | 0), limit: Math.min(1000, Math.max(1, query.limit | 0)) });
  });
  handle('scan:ids', (id: unknown, cat: unknown, autoOnly: unknown) => session(id)?.ids(typeof cat === 'string' ? cat : undefined, autoOnly === true) ?? []);
  handle('scan:groups', (id: unknown, offset: unknown, limit: unknown, sort: unknown) =>
    session(id)?.groupPage(Number(offset) || 0, Math.min(500, Number(limit) || 50), sort === 'size' || sort === 'count' ? sort : 'recoverable') ?? { groups: [], total: 0, recoverable: 0 },
  );
  handle('scan:defaultDuplicateSelection', (id: unknown) => session(id)?.defaultDuplicateSelection() ?? []);
  handle('scan:thumbnail', async (id: unknown, itemId: unknown) => {
    const it = session(id)?.byId.get(Number(itemId));
    if (!it || it.isDir || !/\.(jpe?g|png|gif|webp|bmp|ico|heic|tiff?)$/i.test(it.path)) return null;
    try {
      const img = await nativeImage.createThumbnailFromPath(it.path, { width: 360, height: 360 });
      if (!img.isEmpty()) return img.toDataURL();
    } catch {
      /* fall back below (createThumbnailFromPath is Windows/macOS only) */
    }
    if (it.size > 12 * 1024 * 1024 || /\.(heic|tiff?)$/i.test(it.path)) return null;
    try {
      const img = nativeImage.createFromBuffer(await fsp.readFile(it.path));
      if (img.isEmpty()) return null;
      return img.resize({ width: 360 }).toDataURL();
    } catch {
      return null;
    }
  });

  handle('analyzer:overview', (id: unknown) => session(id)?.overview() ?? null);
  handle('analyzer:children', (id: unknown, nodeId: unknown) => session(id)?.children(Number(nodeId)) ?? null);

  handle('clean:estimate', (id: unknown, ids: unknown) => {
    const s = session(id);
    if (!s || !Array.isArray(ids)) return { count: 0, bytes: 0, personalCount: 0, folderCount: 0, categories: [], allCopiesGroups: 0 };
    return s.estimate(ids.filter((x) => typeof x === 'number'));
  });
  handle('clean:execute', (req: unknown) => runClean(req as CleanRequest));

  handle('recycle:info', () => sys.recycleBinInfo());
  handle('recycle:empty', async (confirmation: unknown) => {
    if (confirmation !== PERMANENT_CONFIRM_PHRASE) return { ok: false, error: 'Not confirmed' };
    const before = await sys.recycleBinInfo();
    try {
      await sys.emptyRecycleBin();
      const historyId = store.addCleaning(
        { date: Date.now(), mode: 'empty-recycle-bin', removed: before.count, failed: 0, skipped: 0, bytes: before.bytes, categories: ['recycleBin'], source: 'recycleBin' },
        [],
      );
      for (const s of manager.sessions.values()) {
        const c = s.summary.categories.find((x) => x.id === 'recycleBin');
        if (c) {
          c.count = 0;
          c.bytes = 0;
          s.recomputeSummary();
          store.saveScan(s.summary);
        }
      }
      return { ok: true, historyId };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  handle('apps:list', () => sys.listInstalledApps());
  handle('apps:uninstall', async (id: unknown) => {
    try {
      await sys.launchUninstaller(str(id));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  handle('apps:openWindowsSettings', () => (sys.isWindows ? shell.openExternal('ms-settings:appsfeatures') : undefined));

  handle('history:list', (limit: unknown) => store.listCleanings(Number(limit) || 500));
  handle('history:details', (id: unknown) => store.cleaningDetails(Number(id)));
  handle('history:clear', () => store.clearHistory());
  handle('history:export', async (format: unknown) => {
    const fmt = format === 'csv' ? 'csv' : 'json';
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: path.join(app.getPath('documents'), `fristy-cleaning-history-${new Date().toISOString().slice(0, 10)}.${fmt}`),
      filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }],
    });
    if (r.canceled || !r.filePath) return null;
    const entries = store.listCleanings(100000).map((e) => store.cleaningDetails(e.id)!).filter(Boolean);
    if (fmt === 'json') await fsp.writeFile(r.filePath, JSON.stringify(entries, null, 2), 'utf8');
    else {
      const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = ['cleaning_id,date,mode,path,size_bytes,category,status,error'];
      for (const e of entries) {
        if (!e.items.length) rows.push([e.id, new Date(e.date).toISOString(), e.mode, '', e.bytes, e.categories.join('|'), '', ''].map(q).join(','));
        for (const i of e.items) rows.push([e.id, new Date(e.date).toISOString(), e.mode, i.path, i.size, i.categoryId, i.status, i.error].map(q).join(','));
      }
      await fsp.writeFile(r.filePath, '﻿' + rows.join('\r\n'), 'utf8');
    }
    return r.filePath;
  });

  handle('dashboard:stats', async (): Promise<DashboardStats> => {
    const drives = await sys.listDrives().catch(() => []);
    const quick = [...manager.sessions.values()].find((s) => s.summary.kind === 'quick')?.summary ?? store.latestScan('quick');
    const last = store.latestScan();
    const totals = store.totals();
    return {
      drives,
      totalBytes: drives.reduce((a, d) => a + d.total, 0),
      usedBytes: drives.reduce((a, d) => a + d.used, 0),
      freeBytes: drives.reduce((a, d) => a + d.free, 0),
      recoverableBytes: quick ? quick.totalBytes : null,
      unnecessaryFiles: quick ? quick.totalCount : null,
      lastScanAt: last?.finishedAt ?? null,
      totalRecovered: totals.bytes,
      cleaningsCount: totals.count,
    };
  });
}

/* ---------------- Lifecycle ---------------- */

app.on('second-instance', () => showWindow());
app.on('before-quit', () => {
  quitting = true;
  manager.cancelAll();
  try {
    store?.flush();
  } catch {
    /* ignore */
  }
});
app.on('window-all-closed', () => {
  if (!tray) app.quit();
});

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  store = await Store.open(path.join(app.getPath('userData'), 'fristy.db'));
  settings = loadSettings();
  store.pruneHistory(settings.historyRetentionDays);
  registerIpc();
  createWindow();
  applySystemSettings();

  scheduler = new Scheduler(
    () => ({ schedule: settings.schedule, lastRun: store.getKV<number>('scheduler.lastRun') ?? 0, anchor: store.getKV<number>('scheduler.anchor') ?? Date.now() }),
    async () => {
      store.setKV('scheduler.lastRun', Date.now());
      if (manager.isRunning('quick')) return;
      // Scheduled scans only scan and notify. They never delete files.
      const { done } = await startScan({ kind: 'quick', scheduled: true });
      await done;
    },
  );
  if (store.getKV<number>('scheduler.anchor') == null) store.setKV('scheduler.anchor', Date.now());
  scheduler.start();
});
