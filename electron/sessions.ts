/**
 * Owns scan workers and the in-memory results of completed scans. The renderer only ever receives
 * pages of results and refers to files by item id; paths for deletion always come from here.
 */
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type {
  AnalyzerOverview, CategoryInfo, CleanEstimate, DuplicateGroup, GroupPage, ItemPage, ItemQuery, ResultItem,
  ScanKind, ScanProgress, ScanRequest, ScanSummary, TreeChildren, TreeEntry,
} from '../src/shared/types';
import type { AnalyzerData, EngineResult, EngineState, EngineTask } from './scanner/engine';

export class Session {
  byId = new Map<number, ResultItem>();
  groups = new Map<number, { id: number; size: number; hash: string; itemIds: number[]; keepId: number }>();
  private sortCache = new Map<string, ResultItem[]>();
  private nodePaths: (string | undefined)[] = [];

  constructor(public summary: ScanSummary, public items: ResultItem[], groups: EngineResult['groups'], public tree: AnalyzerData | null) {
    for (const it of items) this.byId.set(it.id, it);
    for (const g of groups) this.groups.set(g.id, g);
  }

  private sep() {
    return this.summary.roots[0]?.includes('\\') ? '\\' : '/';
  }

  query(q: ItemQuery): ItemPage {
    const key = `${q.categoryId ?? '*'}|${q.sortBy ?? 'size'}|${q.sortDir ?? 'desc'}`;
    let list = this.sortCache.get(key);
    if (!list) {
      list = this.items.filter((i) => !q.categoryId || i.categoryId === q.categoryId);
      const dir = q.sortDir === 'asc' ? 1 : -1;
      const name = (p: string) => p.slice(Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) + 1).toLowerCase();
      const cmp: Record<string, (a: ResultItem, b: ResultItem) => number> = {
        size: (a, b) => a.size - b.size,
        name: (a, b) => name(a.path).localeCompare(name(b.path)),
        type: (a, b) => a.ext.localeCompare(b.ext) || a.size - b.size,
        path: (a, b) => a.path.localeCompare(b.path),
        mtime: (a, b) => a.mtime - b.mtime,
      };
      const f = cmp[q.sortBy ?? 'size'] ?? cmp.size;
      list = [...list].sort((a, b) => dir * f(a, b));
      this.sortCache.set(key, list);
    }
    if (q.search || q.minSize) {
      const s = q.search?.toLowerCase();
      list = list.filter((i) => (!s || i.path.toLowerCase().includes(s)) && (!q.minSize || i.size >= q.minSize));
    }
    const totalBytes = list.reduce((a, b) => a + b.size, 0);
    return { items: list.slice(q.offset, q.offset + q.limit), total: list.length, totalBytes };
  }

  ids(categoryId?: string, autoOnly?: boolean): number[] {
    const autoCats = new Set(this.summary.categories.filter((c) => c.autoSelect).map((c) => c.id));
    return this.items
      .filter((i) => (!categoryId || i.categoryId === categoryId) && (!autoOnly || (autoCats.has(i.categoryId) && !i.personal)))
      .map((i) => i.id);
  }

  groupPage(offset: number, limit: number, sort: 'recoverable' | 'size' | 'count'): GroupPage {
    const all = [...this.groups.values()].map((g) => ({ g, rec: g.size * (g.itemIds.length - 1) }));
    all.sort((a, b) => (sort === 'size' ? b.g.size - a.g.size : sort === 'count' ? b.g.itemIds.length - a.g.itemIds.length : b.rec - a.rec));
    const groups: DuplicateGroup[] = all.slice(offset, offset + limit).map(({ g, rec }) => ({
      id: g.id, size: g.size, hash: g.hash, recoverable: rec,
      items: g.itemIds.map((id) => this.byId.get(id)).filter((x): x is ResultItem => !!x)
        .sort((a, b) => Number(b.id === g.keepId) - Number(a.id === g.keepId)),
    }));
    return { groups, total: all.length, recoverable: all.reduce((a, b) => a + b.rec, 0) };
  }

  /** Every copy except the kept one, skipping personal-folder copies (those need manual selection). */
  defaultDuplicateSelection(): number[] {
    const out: number[] = [];
    for (const g of this.groups.values()) for (const id of g.itemIds) if (id !== g.keepId && !this.byId.get(id)?.personal) out.push(id);
    return out;
  }

  estimate(ids: number[]): CleanEstimate {
    const seen = new Set<string>();
    const cats = new Map<string, { id: string; count: number; bytes: number }>();
    let bytes = 0;
    let count = 0;
    let personal = 0;
    let folders = 0;
    const selected = new Set(ids);
    for (const id of ids) {
      const it = this.byId.get(id);
      if (!it) continue;
      const k = it.path.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      count++;
      bytes += it.size;
      if (it.personal) personal++;
      if (it.isDir) folders++;
      const c = cats.get(it.categoryId) ?? { id: it.categoryId, count: 0, bytes: 0 };
      c.count++;
      c.bytes += it.size;
      cats.set(it.categoryId, c);
    }
    let allCopies = 0;
    for (const g of this.groups.values()) if (g.itemIds.length && g.itemIds.every((i) => selected.has(i))) allCopies++;
    return { count, bytes, personalCount: personal, folderCount: folders, categories: [...cats.values()], allCopiesGroups: allCopies };
  }

  /** Removes cleaned paths from the session so the UI reflects reality. */
  removePaths(paths: Set<string>) {
    const gone = new Set<number>();
    for (const it of this.items) if (paths.has(it.path)) gone.add(it.id);
    if (!gone.size) return;
    this.items = this.items.filter((i) => !gone.has(i.id));
    for (const id of gone) this.byId.delete(id);
    for (const g of [...this.groups.values()]) {
      g.itemIds = g.itemIds.filter((i) => !gone.has(i));
      if (g.itemIds.length < 2) {
        const lone = new Set(g.itemIds);
        for (const i of lone) this.byId.delete(i);
        this.items = this.items.filter((i) => !lone.has(i.id));
        this.groups.delete(g.id);
      } else if (!g.itemIds.includes(g.keepId)) g.keepId = g.itemIds[0];
    }
    this.sortCache.clear();
    this.recomputeSummary();
  }

  recomputeSummary() {
    for (const c of this.summary.categories) {
      if (c.id === 'recycleBin') continue;
      const its = this.items.filter((i) => i.categoryId === c.id);
      c.count = its.length;
      c.bytes = c.id === 'duplicates' ? [...this.groups.values()].reduce((a, g) => a + g.size * (g.itemIds.length - 1), 0) : its.reduce((a, b) => a + b.size, 0);
    }
    const totals = uniqueTotals(this.items, this.groups);
    this.summary.totalBytes = totals.bytes + (this.summary.categories.find((c) => c.id === 'recycleBin')?.bytes ?? 0);
    this.summary.totalCount = totals.count;
    this.summary.duplicateGroups = this.groups.size;
  }

  /* ---------- analyzer ---------- */

  nodePath(id: number): string {
    const cached = this.nodePaths[id];
    if (cached) return cached;
    const n = this.tree!.nodes[id];
    const p = n.parent < 0 ? n.name : path.join(this.nodePath(n.parent), n.name);
    this.nodePaths[id] = p;
    return p;
  }

  private entryForNode(id: number): TreeEntry {
    const n = this.tree!.nodes[id];
    return {
      id, name: n.parent < 0 ? n.name : n.name, path: this.nodePath(id), size: n.size, isDir: true, fileCount: n.fileCount,
      dirCount: n.dirCount, mtime: n.mtime, hasChildren: n.childDirs.length > 0 || n.directFileCount > 0,
    };
  }

  children(nodeId: number): TreeChildren | null {
    if (!this.tree || !this.tree.nodes[nodeId]) return null;
    const n = this.tree.nodes[nodeId];
    const dirPath = this.nodePath(nodeId);
    const sep = this.sep();
    const children: TreeEntry[] = n.childDirs.map((c) => this.entryForNode(c));
    for (const f of n.topFiles) {
      children.push({ id: -1, name: f.name, path: dirPath.endsWith(sep) ? dirPath + f.name : dirPath + sep + f.name, size: f.size, isDir: false, fileCount: 1, dirCount: 0, mtime: f.mtime, hasChildren: false });
    }
    children.sort((a, b) => b.size - a.size);
    const keptBytes = n.topFiles.reduce((a, b) => a + b.size, 0);
    const breadcrumb: { id: number; name: string }[] = [];
    for (let cur = nodeId; cur >= 0; cur = this.tree.nodes[cur].parent) breadcrumb.unshift({ id: cur, name: this.tree.nodes[cur].name });
    return {
      node: this.entryForNode(nodeId),
      breadcrumb,
      children,
      otherFiles: { count: n.directFileCount - n.topFiles.length, bytes: n.directFileBytes - keptBytes },
    };
  }

  overview(): AnalyzerOverview | null {
    if (!this.tree) return null;
    const t = this.tree;
    const roots = new Set(t.roots);
    const folders = t.nodes.filter((n) => !roots.has(n.id)).sort((a, b) => b.size - a.size).slice(0, 100);
    return {
      roots: t.roots.map((r) => this.entryForNode(r)),
      extStats: t.extStats.slice(0, 40),
      largestFiles: t.largestFiles.slice(0, 150).map((f) => ({
        id: -1, name: path.basename(f.path), path: f.path, size: f.size, isDir: false, fileCount: 1, dirCount: 0, mtime: f.mtime, hasChildren: false,
      })),
      largestFolders: folders.map((f) => this.entryForNode(f.id)),
    };
  }
}

export function uniqueTotals(items: ResultItem[], groups: Map<number, { size: number; itemIds: number[]; keepId: number }>) {
  // Duplicate groups count all copies but one; other categories count each path once.
  const seen = new Set<string>();
  let bytes = 0;
  let count = 0;
  const keepers = new Set([...groups.values()].map((g) => g.keepId));
  for (const it of items) {
    if (keepers.has(it.id)) continue;
    const k = it.path.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    bytes += it.size;
    count++;
  }
  return { bytes, count };
}

interface ActiveScan {
  scanId: string;
  kind: ScanKind;
  req: ScanRequest;
  worker: Worker;
  startedAt: number;
  progress: ScanProgress;
  expectedBytes: number | null;
  hashStartElapsed: number | null;
  hashStartBytes: number;
  roots: string[];
  extraCategories: CategoryInfo[];
  resolve: (s: ScanSummary) => void;
}

export interface ScanManagerEvents {
  progress(p: ScanProgress): void;
  complete(s: ScanSummary, session: Session | null): void;
}

export class ScanManager {
  readonly sessions = new Map<string, Session>();
  private active = new Map<string, ActiveScan>();
  private counter = 0;

  constructor(private workerFile: string, private events: ScanManagerEvents) {}

  activeProgress(): ScanProgress[] {
    return [...this.active.values()].map((a) => a.progress);
  }

  isRunning(kind?: ScanKind) {
    return [...this.active.values()].some((a) => !kind || a.kind === kind);
  }

  /** Starts a scan. `extraCategories` (e.g. Recycle Bin) are merged into the summary. */
  start(req: ScanRequest, task: Omit<EngineTask, 'scanId'>, extraCategories: Promise<CategoryInfo[]> = Promise.resolve([])): { scanId: string; done: Promise<ScanSummary> } {
    if (this.isRunning(req.kind)) throw new Error('A scan of this type is already running.');
    const scanId = `${req.kind}-${Date.now().toString(36)}-${(++this.counter).toString(36)}`;
    const worker = new Worker(this.workerFile);
    let resolve!: (s: ScanSummary) => void;
    const done = new Promise<ScanSummary>((r) => (resolve = r));
    const a: ActiveScan = {
      scanId, kind: req.kind, req, worker, startedAt: Date.now(), expectedBytes: task.expectedBytes, hashStartElapsed: null,
      hashStartBytes: 0, roots: task.roots, extraCategories: [], resolve,
      progress: {
        scanId, kind: req.kind, phase: 'starting', paused: false, filesScanned: 0, dirsScanned: 0, bytesScanned: 0, currentPath: '',
        elapsedMs: 0, etaMs: null, errors: 0, hashedBytes: 0, hashTotalBytes: 0, itemsFound: 0, bytesFound: 0,
      },
    };
    this.active.set(scanId, a);
    void extraCategories.then((c) => (a.extraCategories = c)).catch(() => {});
    const extraReady = extraCategories.catch(() => [] as CategoryInfo[]);

    worker.on('message', (msg: { type: string; state?: EngineState; paused?: boolean; elapsedMs?: number; result?: EngineResult; message?: string }) => {
      if (msg.type === 'progress' && msg.state) this.updateProgress(a, msg.state, msg.elapsedMs ?? 0, msg.paused ?? false);
      else if (msg.type === 'paused') {
        a.progress = { ...a.progress, paused: !!msg.paused, etaMs: null };
        this.events.progress(a.progress);
      } else if (msg.type === 'result' && msg.result) {
        void extraReady.then((extra) => this.finish(a, msg.result!, extra, msg.elapsedMs ?? 0));
      } else if (msg.type === 'cancelled') this.finishEmpty(a, 'cancelled', msg.state);
      else if (msg.type === 'error') this.finishEmpty(a, 'error', msg.state, msg.message);
    });
    worker.on('error', (e) => this.finishEmpty(a, 'error', undefined, e.message));
    worker.on('exit', (code) => {
      if (this.active.has(scanId)) this.finishEmpty(a, 'error', undefined, `Scanner stopped unexpectedly (code ${code}).`);
    });
    worker.postMessage({ type: 'start', task: { ...task, scanId } });
    return { scanId, done };
  }

  private updateProgress(a: ActiveScan, s: EngineState, elapsedMs: number, paused: boolean) {
    let eta: number | null = null;
    if (!paused) {
      if (s.phase === 'hashing' && s.hashTotalBytes > 0) {
        if (a.hashStartElapsed == null) {
          a.hashStartElapsed = elapsedMs;
          a.hashStartBytes = s.hashedBytes;
        }
        const dt = elapsedMs - a.hashStartElapsed;
        const db = s.hashedBytes - a.hashStartBytes;
        if (dt > 3000 && db > 0) eta = ((s.hashTotalBytes - s.hashedBytes) / db) * dt;
      } else if (s.phase === 'enumerating' && a.expectedBytes && a.expectedBytes > 0) {
        const r = s.bytesScanned / a.expectedBytes;
        if (r > 0.03 && r < 0.98 && elapsedMs > 5000) eta = (elapsedMs * (1 - r)) / r;
      }
    }
    a.progress = {
      scanId: a.scanId, kind: a.kind, phase: s.phase, paused, filesScanned: s.filesScanned, dirsScanned: s.dirsScanned,
      bytesScanned: s.bytesScanned, currentPath: s.currentPath, elapsedMs, etaMs: eta, errors: s.errors, hashedBytes: s.hashedBytes,
      hashTotalBytes: s.hashTotalBytes, itemsFound: s.itemsFound, bytesFound: s.bytesFound,
    };
    this.events.progress(a.progress);
  }

  private finish(a: ActiveScan, r: EngineResult, extra: CategoryInfo[], elapsedMs: number) {
    this.active.delete(a.scanId);
    void a.worker.terminate();
    const categories = [...r.categories, ...extra];
    const groups = new Map(r.groups.map((g) => [g.id, g]));
    const totals = uniqueTotals(r.items, groups);
    const summary: ScanSummary = {
      scanId: a.scanId, kind: a.kind, startedAt: a.startedAt, finishedAt: a.startedAt + elapsedMs, roots: a.roots, categories,
      totalBytes: totals.bytes + extra.reduce((s, c) => s + c.bytes, 0), totalCount: totals.count,
      filesScanned: r.state.filesScanned, dirsScanned: r.state.dirsScanned, bytesScanned: r.state.bytesScanned, errors: r.state.errors,
      skippedLinks: r.state.skippedLinks, protectedSkipped: r.state.protectedSkipped, cancelled: false, scheduled: !!a.req.scheduled,
      duplicateGroups: r.groups.length,
    };
    summary.finishedAt = Date.now();
    const session = new Session(summary, r.items, r.groups, r.tree);
    // Keep only the most recent session per scan kind to bound memory use.
    for (const [id, s] of this.sessions) if (s.summary.kind === a.kind) this.sessions.delete(id);
    this.sessions.set(a.scanId, session);
    this.events.progress({ ...a.progress, phase: 'done', etaMs: null, elapsedMs });
    this.events.complete(summary, session);
    a.resolve(summary);
  }

  private finishEmpty(a: ActiveScan, how: 'cancelled' | 'error', s?: EngineState, message?: string) {
    if (!this.active.has(a.scanId)) return;
    this.active.delete(a.scanId);
    void a.worker.terminate();
    const summary: ScanSummary = {
      scanId: a.scanId, kind: a.kind, startedAt: a.startedAt, finishedAt: Date.now(), roots: a.roots, categories: [], totalBytes: 0,
      totalCount: 0, filesScanned: s?.filesScanned ?? 0, dirsScanned: s?.dirsScanned ?? 0, bytesScanned: s?.bytesScanned ?? 0,
      errors: s?.errors ?? 0, skippedLinks: s?.skippedLinks ?? 0, protectedSkipped: s?.protectedSkipped ?? 0, cancelled: how === 'cancelled',
      scheduled: !!a.req.scheduled, errorMessage: message,
    };
    this.events.progress({ ...a.progress, phase: how, etaMs: null });
    this.events.complete(summary, null);
    a.resolve(summary);
  }

  control(scanId: string, type: 'pause' | 'resume' | 'cancel') {
    const a = this.active.get(scanId);
    if (!a) return;
    a.worker.postMessage({ type });
  }

  cancelAll() {
    for (const a of this.active.values()) a.worker.postMessage({ type: 'cancel' });
  }
}
