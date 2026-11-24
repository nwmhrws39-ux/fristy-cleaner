/**
 * FRISTY scanning engine.
 *
 * Runs inside a worker thread (see worker.ts) but has no worker / Electron dependencies so it can be
 * unit tested directly. It never deletes anything: it only reads directory listings, file metadata and
 * (for duplicate verification) file contents through streams.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import nodePath from 'node:path';
import type { CategoryInfo, DeepDetectOptions, ResultItem, RiskLevel, ScanKind, ScanPhase } from '../../src/shared/types';
import {
  classifyPath, isUnder, normalizeForCompare, pathLib, type ProtectionConfig, type ProtectionVerdict,
} from '../protection';
import type { QuickTarget } from './targets';

export interface EngineTask {
  scanId: string;
  kind: ScanKind;
  roots: string[];
  targets?: QuickTarget[];
  detect: DeepDetectOptions;
  largeMinBytes: number;
  dupMinBytes: number;
  cacheMinBytes: number;
  protection: ProtectionConfig;
  followLinks: boolean;
  skipRecentHours: number;
  oldDownloadDays: number;
  installerDays: number;
  downloadsDirs: string[];
  /** Folders where empty sub-folders are never reported (application data). */
  noEmptyFolderRoots: string[];
  /** Cloud-synced roots (OneDrive). Files there are not hashed so nothing gets downloaded. */
  cloudRoots: string[];
  skipCloudHashing: boolean;
  /** Used-bytes of the drives being scanned when all roots are drive roots, for a reliable ETA. */
  expectedBytes: number | null;
  /** Also treat the creation time as "last activity" (a file downloaded yesterday is not old). */
  ageUsesCreationTime: boolean;
  now: number;
}

export interface EngineState {
  phase: ScanPhase;
  filesScanned: number;
  dirsScanned: number;
  bytesScanned: number;
  currentPath: string;
  errors: number;
  hashedBytes: number;
  hashTotalBytes: number;
  itemsFound: number;
  bytesFound: number;
  skippedLinks: number;
  protectedSkipped: number;
}

export interface EngineHooks {
  /** Called frequently; the caller is expected to throttle. */
  progress(state: EngineState): void;
  /** Awaited regularly; resolves immediately unless paused; throws CancelledError when cancelled. */
  checkpoint(): Promise<void>;
}

export class CancelledError extends Error {
  constructor() {
    super('Scan cancelled');
  }
}

export interface AnalyzerNode {
  id: number;
  parent: number;
  name: string;
  size: number;
  fileCount: number;
  dirCount: number;
  mtime: number;
  childDirs: number[];
  topFiles: { name: string; size: number; mtime: number }[];
  directFileCount: number;
  directFileBytes: number;
}

export interface AnalyzerData {
  nodes: AnalyzerNode[];
  roots: number[];
  extStats: { ext: string; bytes: number; count: number }[];
  largestFiles: { path: string; size: number; mtime: number }[];
}

export interface EngineResult {
  items: ResultItem[];
  categories: CategoryInfo[];
  groups: { id: number; size: number; hash: string; itemIds: number[]; keepId: number }[];
  tree: AnalyzerData | null;
  state: EngineState;
  errorSamples: { path: string; code: string }[];
}

const FILE_STAT_BATCH = 48;
const TOP_FILES_PER_DIR = 25;
const LARGEST_FILES = 300;
const PARTIAL_HASH_BYTES = 64 * 1024;
const MAX_ERROR_SAMPLES = 200;

export const CACHE_DIR_NAMES = new Set([
  'cache', 'caches', 'cache2', 'code cache', 'gpucache', 'shadercache', 'grshadercache', 'cacheddata',
  'dxcache', 'glcache', 'd3dscache', '.cache', 'npm-cache', '_cacache',
]);
const INSTALLER_EXT = new Set(['.msi', '.msix', '.msixbundle', '.appx', '.appxbundle', '.msp']);
const TEMP_EXT = new Set(['.tmp', '.temp', '._mp', '.dmp', '.chk']);
const TEMP_NAMES = new Set(['thumbs.db', 'ehthumbs.db', 'ehthumbs_vista.db']);

interface DirFrame {
  path: string;
  norm: string;
  verdict: ProtectionVerdict;
  /** Topmost cache folder this directory is in, if any. */
  inCache: boolean;
  isCacheRoot: boolean;
  inDownloads: boolean;
  inCloud: boolean;
  node?: AnalyzerNode;
}

interface DirResult {
  size: number;
  files: number;
  dirs: number;
  /** No files anywhere below (recursively), nothing unreadable, no links. */
  empty: boolean;
}

interface Visitor {
  maxDepth: number;
  /** Return false to skip descending into a directory (it is still counted as protected). */
  shouldDescend?(frame: DirFrame): boolean;
  onFile?(path: string, name: string, st: fs.Stats, frame: DirFrame): void;
  onExit?(frame: DirFrame, result: DirResult, emptyChildren: string[]): void;
  onEnter?(frame: DirFrame, parent: DirFrame | null, name: string, st: fs.Stats | null): void;
}

export class ScanEngine {
  readonly state: EngineState = {
    phase: 'starting', filesScanned: 0, dirsScanned: 0, bytesScanned: 0, currentPath: '', errors: 0,
    hashedBytes: 0, hashTotalBytes: 0, itemsFound: 0, bytesFound: 0, skippedLinks: 0, protectedSkipped: 0,
  };
  private items: ResultItem[] = [];
  private seenPaths = new Set<string>();
  private nextId = 1;
  private errorSamples: { path: string; code: string }[] = [];
  private visitedReal = new Set<string>();
  private lib;
  private downloadsNorm: string[];
  private cloudNorm: string[];
  private noEmptyNorm: string[];
  private catInaccessible = new Map<string, number>();
  private catLocations = new Map<string, string[]>();

  constructor(private task: EngineTask, private hooks: EngineHooks) {
    this.lib = pathLib(task.protection);
    const w = task.protection.windows;
    this.downloadsNorm = task.downloadsDirs.map((d) => normalizeForCompare(d, w));
    this.cloudNorm = task.cloudRoots.map((d) => normalizeForCompare(d, w));
    this.noEmptyNorm = task.noEmptyFolderRoots.map((d) => normalizeForCompare(d, w));
  }

  private get w() {
    return this.task.protection.windows;
  }

  private norm(p: string) {
    return normalizeForCompare(p, this.w);
  }

  private error(path: string, e: unknown) {
    this.state.errors++;
    if (this.errorSamples.length < MAX_ERROR_SAMPLES) {
      this.errorSamples.push({ path, code: (e as NodeJS.ErrnoException)?.code || String(e) });
    }
  }

  private tick() {
    this.hooks.progress(this.state);
  }

  /** Whether a directory that is itself protected may contain allowed descendants (e.g. Windows\Temp). */
  private hasAllowedDescendant(norm: string): boolean {
    return this.task.protection.rules.some((r) => r.verdict !== 'block' && r.prefix !== norm && isUnder(r.prefix, norm, this.w));
  }

  private makeFrame(path: string, parent: DirFrame | null, name: string): DirFrame {
    const norm = this.norm(path);
    const verdict = classifyPath(path, this.task.protection);
    const lower = name.toLowerCase();
    const isCacheRoot = !parent?.inCache && CACHE_DIR_NAMES.has(lower);
    return {
      path,
      norm,
      verdict,
      inCache: !!parent?.inCache || isCacheRoot,
      isCacheRoot,
      inDownloads: parent?.inDownloads || this.downloadsNorm.some((d) => isUnder(norm, d, this.w)),
      inCloud: parent?.inCloud || this.cloudNorm.some((d) => isUnder(norm, d, this.w)),
    };
  }

  private fileVerdict(name: string, frame: DirFrame): ProtectionVerdict {
    if (frame.verdict.blocked) return frame.verdict;
    const lower = name.toLowerCase();
    for (const b of this.task.protection.blockedFileNames) {
      if (b.endsWith('*') ? lower.startsWith(b.slice(0, -1)) : lower === b) {
        return { blocked: true, reason: 'protect.criticalFile', personal: false };
      }
    }
    return frame.verdict;
  }

  private isExcluded(norm: string) {
    return this.task.protection.exclusions.some((e) => isUnder(norm, e, this.w));
  }

  private async walk(root: string, visitor: Visitor): Promise<DirResult | null> {
    let st: fs.Stats;
    try {
      st = await fsp.stat(root);
    } catch (e) {
      // A location that simply does not exist on this machine is not an error.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && (e as NodeJS.ErrnoException).code !== 'ENOTDIR') this.error(root, e);
      return null;
    }
    if (!st.isDirectory()) return null;
    if (this.isExcluded(this.norm(root))) return null;
    const frame = this.makeFrame(root, null, this.lib.basename(root));
    return this.walkDir(frame, null, 0, visitor, root, st);
  }

  private async walkDir(frame: DirFrame, parent: DirFrame | null, depth: number, visitor: Visitor, name: string, st: fs.Stats | null): Promise<DirResult> {
    await this.hooks.checkpoint();
    if (visitor.shouldDescend && !visitor.shouldDescend(frame)) {
      this.state.protectedSkipped++;
      return { size: 0, files: 0, dirs: 0, empty: false };
    }
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(frame.path, { withFileTypes: true });
    } catch (e) {
      this.error(frame.path, e);
      return { size: 0, files: 0, dirs: 0, empty: false };
    }
    this.state.dirsScanned++;
    this.state.currentPath = frame.path;
    visitor.onEnter?.(frame, parent, name, st);
    this.tick();

    let size = 0;
    let files = 0;
    let dirs = 0;
    let hasOther = false;
    const subdirs: { path: string; name: string; st: fs.Stats | null }[] = [];
    const fileEntries: { path: string; name: string }[] = [];

    for (const e of entries) {
      const full = this.lib.join(frame.path, e.name);
      if (this.task.protection.exclusions.length && this.isExcluded(this.norm(full))) {
        hasOther = true;
        continue;
      }
      if (e.isSymbolicLink()) {
        // Symbolic links, junctions and other reparse points (including cloud placeholders) are not
        // followed unless the user explicitly enabled it.
        hasOther = true;
        if (!this.task.followLinks) {
          this.state.skippedLinks++;
          continue;
        }
        try {
          const target = await fsp.stat(full);
          if (target.isDirectory()) {
            const real = this.norm(await fsp.realpath(full));
            if (this.visitedReal.has(real)) continue;
            this.visitedReal.add(real);
            subdirs.push({ path: full, name: e.name, st: target });
          }
          // Linked files are never reported as removable.
        } catch (err) {
          this.error(full, err);
        }
        continue;
      }
      if (e.isDirectory()) subdirs.push({ path: full, name: e.name, st: null });
      else if (e.isFile()) fileEntries.push({ path: full, name: e.name });
      else hasOther = true;
    }

    for (let i = 0; i < fileEntries.length; i += FILE_STAT_BATCH) {
      const batch = fileEntries.slice(i, i + FILE_STAT_BATCH);
      const stats = await Promise.all(
        batch.map((f) =>
          fsp.lstat(f.path).catch((err) => {
            this.error(f.path, err);
            return null;
          }),
        ),
      );
      for (let k = 0; k < batch.length; k++) {
        const s = stats[k];
        if (!s || !s.isFile()) {
          hasOther = true;
          continue;
        }
        size += s.size;
        files++;
        this.state.filesScanned++;
        this.state.bytesScanned += s.size;
        visitor.onFile?.(batch[k].path, batch[k].name, s, frame);
      }
      await this.hooks.checkpoint();
      this.tick();
    }

    const emptyChildren: string[] = [];
    let allChildrenEmpty = true;
    if (depth < visitor.maxDepth) {
      for (const sd of subdirs) {
        const child = this.makeFrame(sd.path, frame, sd.name);
        const r = await this.walkDir(child, frame, depth + 1, visitor, sd.name, sd.st);
        size += r.size;
        files += r.files;
        dirs += 1 + r.dirs;
        if (r.empty) emptyChildren.push(sd.path);
        else allChildrenEmpty = false;
      }
    } else if (subdirs.length) {
      allChildrenEmpty = false;
    }
    const result: DirResult = { size, files, dirs, empty: files === 0 && !hasOther && allChildrenEmpty };
    visitor.onExit?.(frame, result, emptyChildren);
    return result;
  }

  private addItem(item: Omit<ResultItem, 'id' | 'ext'> & { ext?: string }): ResultItem | null {
    const key = this.norm(item.path);
    if (item.categoryId !== 'duplicates') {
      if (this.seenPaths.has(key)) return null;
      this.seenPaths.add(key);
    }
    const full: ResultItem = {
      ...item,
      ext: item.ext ?? (item.isDir ? '' : this.lib.extname(item.path).toLowerCase()),
      id: this.nextId++,
    };
    this.items.push(full);
    this.state.itemsFound++;
    this.state.bytesFound += item.size;
    return full;
  }

  private ageHours(st: fs.Stats) {
    const last = this.task.ageUsesCreationTime ? Math.max(st.mtimeMs, st.birthtimeMs || 0) : st.mtimeMs;
    return (this.task.now - last) / 3_600_000;
  }

  /* ---------------- Quick scan ---------------- */

  private async expandWildcards(p: string): Promise<string[]> {
    const parts = p.split(/[\\/]/);
    const idx = parts.indexOf('*');
    if (idx < 0) return [p];
    const sep = this.w ? '\\' : '/';
    const base = parts.slice(0, idx).join(sep) || sep;
    const rest = parts.slice(idx + 1).join(sep);
    let names: string[] = [];
    try {
      names = (await fsp.readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const n of names) out.push(...(await this.expandWildcards(rest ? this.lib.join(base, n, rest) : this.lib.join(base, n))));
    return out;
  }

  private async runQuick(): Promise<CategoryInfo[]> {
    const targets = this.task.targets ?? [];
    const cats: CategoryInfo[] = [];
    for (const t of targets) {
      const patterns = t.namePatterns.map((s) => new RegExp(s, 'i'));
      const before = { count: this.state.itemsFound, bytes: this.state.bytesFound };
      const paths: string[] = [];
      for (const p of t.paths) paths.push(...(await this.expandWildcards(p)));
      let inaccessible = 0;
      const existing: string[] = [];
      for (const p of paths) {
        const errorsBefore = this.state.errors;
        const r = await this.walk(p, {
          maxDepth: t.maxDepth,
          shouldDescend: (frame) => !frame.verdict.blocked || this.hasAllowedDescendant(frame.norm),
          onFile: (path, name, st, frame) => {
            if (patterns.length && !patterns.some((re) => re.test(name))) return;
            if (this.ageHours(st) < t.minAgeHours) return;
            const v = this.fileVerdict(name, frame);
            if (v.blocked) {
              this.state.protectedSkipped++;
              return;
            }
            this.addItem({
              path, size: st.size, mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs, categoryId: t.categoryId,
              reason: t.reason, risk: t.risk, isDir: false, personal: v.personal,
            });
          },
        });
        if (r) existing.push(p);
        else if (this.state.errors > errorsBefore) inaccessible++;
      }
      const catItems = this.state.itemsFound - before.count;
      cats.push({
        id: t.categoryId, count: catItems, bytes: this.state.bytesFound - before.bytes, risk: t.risk,
        autoSelect: t.autoSelect, locations: existing, inaccessible,
      });
    }
    return cats;
  }

  /* ---------------- Deep / large / duplicate scans ---------------- */

  private dupCandidates = new Map<number, { p: string; m: number; b: number; personal: boolean; cloud: boolean }[]>();

  private async runFileScan(): Promise<CategoryInfo[]> {
    const t = this.task;
    const d = t.detect;
    const recentH = t.skipRecentHours;
    const catDefs: Record<string, { risk: RiskLevel; autoSelect: boolean }> = {
      tempFiles: { risk: 'safe', autoSelect: true },
      largeCaches: { risk: 'safe', autoSelect: false },
      installers: { risk: 'review', autoSelect: false },
      oldDownloads: { risk: 'review', autoSelect: false },
      large: { risk: 'review', autoSelect: false },
      emptyFolders: { risk: 'review', autoSelect: false },
      duplicates: { risk: 'review', autoSelect: false },
    };
    const add = (categoryId: string, path: string, st: fs.Stats | null, size: number, personal: boolean, reason: string, reasonArgs?: Record<string, number>, isDir = false) => {
      const def = catDefs[categoryId];
      this.addItem({
        path, size, mtime: st?.mtimeMs ?? 0, ctime: st ? st.birthtimeMs || st.ctimeMs : 0, categoryId,
        reason, reasonArgs, risk: personal && def.risk === 'safe' ? 'review' : def.risk, isDir, personal,
      });
    };
    const statCache = new Map<string, fs.Stats>();

    const visitor: Visitor = {
      maxDepth: 4096,
      shouldDescend: (frame) => !frame.verdict.blocked || this.hasAllowedDescendant(frame.norm),
      onEnter: (frame, _p, _n, st) => {
        if (st && (d.caches || d.emptyFolders)) statCache.set(frame.path, st);
      },
      onFile: (path, name, st, frame) => {
        const v = this.fileVerdict(name, frame);
        if (v.blocked) {
          this.state.protectedSkipped++;
          return;
        }
        if (frame.inCache) return; // reported as a whole folder (large caches) instead.
        const ext = this.lib.extname(name).toLowerCase();
        const lower = name.toLowerCase();
        const age = this.ageHours(st);
        if (d.duplicates && st.size >= Math.max(1, t.dupMinBytes)) {
          let arr = this.dupCandidates.get(st.size);
          if (!arr) this.dupCandidates.set(st.size, (arr = []));
          arr.push({ p: path, m: st.mtimeMs, b: st.birthtimeMs || st.ctimeMs, personal: v.personal, cloud: frame.inCloud });
        }
        if (d.installers && age >= t.installerDays * 24 && (INSTALLER_EXT.has(ext) || (ext === '.exe' && frame.inDownloads))) {
          return add('installers', path, st, st.size, v.personal, 'reason.installer', { days: Math.floor(age / 24) });
        }
        if (d.oldDownloads && frame.inDownloads && age >= t.oldDownloadDays * 24) {
          return add('oldDownloads', path, st, st.size, v.personal, 'reason.oldDownload', { days: Math.floor(age / 24) });
        }
        if (d.temp && age >= recentH && (TEMP_EXT.has(ext) || TEMP_NAMES.has(lower) || (lower.startsWith('~') && ext === '.tmp'))) {
          return add('tempFiles', path, st, st.size, v.personal, ext === '.dmp' ? 'reason.crashDump' : 'reason.tempFile');
        }
        if (d.large && st.size >= t.largeMinBytes) {
          return add('large', path, st, st.size, v.personal, 'reason.large');
        }
      },
      onExit: (frame, r, emptyChildren) => {
        if (d.caches && frame.isCacheRoot && r.size >= t.cacheMinBytes && !frame.verdict.blocked) {
          add('largeCaches', frame.path, statCache.get(frame.path) ?? null, r.size, frame.verdict.personal, 'reason.largeCache', { files: r.files }, true);
        }
        if (d.emptyFolders && !r.empty) {
          for (const c of emptyChildren) {
            const cn = this.norm(c);
            if (this.noEmptyNorm.some((x) => isUnder(cn, x, this.w))) continue;
            const v = classifyPath(c, t.protection);
            if (v.blocked) continue;
            add('emptyFolders', c, null, 0, v.personal, 'reason.emptyFolder', undefined, true);
          }
        }
        statCache.delete(frame.path);
      },
    };

    const locations: string[] = [];
    for (const root of t.roots) {
      const res = await this.walk(root, visitor);
      if (res) {
        locations.push(root);
        if (d.emptyFolders && res.empty) {
          // The whole root is empty: nothing to report (we never offer the root itself).
        }
      }
    }

    const groups = d.duplicates ? await this.findDuplicates() : [];
    this.groupsOut = groups;

    const order = Object.keys(catDefs).filter((id) =>
      ({ tempFiles: d.temp, largeCaches: d.caches, installers: d.installers, oldDownloads: d.oldDownloads, large: d.large, emptyFolders: d.emptyFolders, duplicates: d.duplicates } as Record<string, boolean>)[id],
    );
    return order.map((id) => {
      const its = this.items.filter((i) => i.categoryId === id);
      let bytes = its.reduce((a, b) => a + b.size, 0);
      if (id === 'duplicates') bytes = groups.reduce((a, g) => a + g.size * (g.itemIds.length - 1), 0);
      return { id, count: its.length, bytes, risk: catDefs[id].risk, autoSelect: catDefs[id].autoSelect, locations, inaccessible: 0 };
    });
  }

  private groupsOut: EngineResult['groups'] = [];

  private async hashFile(path: string, limit?: number): Promise<string> {
    const h = crypto.createHash('sha256');
    const stream = fs.createReadStream(path, { highWaterMark: 1024 * 1024, ...(limit ? { start: 0, end: limit - 1 } : {}) });
    try {
      for await (const chunk of stream) {
        h.update(chunk as Buffer);
        this.state.hashedBytes += (chunk as Buffer).length;
        await this.hooks.checkpoint();
        this.tick();
      }
    } finally {
      stream.destroy();
    }
    return h.digest('hex');
  }

  private async findDuplicates(): Promise<EngineResult['groups']> {
    this.state.phase = 'hashing';
    type Cand = { p: string; m: number; b: number; personal: boolean; cloud: boolean };
    const sizeGroups: [number, Cand[]][] = [];
    for (const [size, arr] of this.dupCandidates) {
      let list = arr;
      if (this.task.skipCloudHashing) list = list.filter((c) => !c.cloud);
      if (list.length >= 2) sizeGroups.push([size, list]);
    }
    this.dupCandidates.clear();
    // Estimate: partial hash of every candidate.
    this.state.hashTotalBytes = sizeGroups.reduce((a, [s, l]) => a + Math.min(s, PARTIAL_HASH_BYTES) * l.length, 0);
    this.tick();

    // 1. Remove hard links of the same physical file (deleting them would not free space).
    // 2. Partial SHA-256 of the first 64 KB.
    const stage2: [number, Cand[]][] = [];
    for (const [size, list] of sizeGroups) {
      const byIno = new Map<string, Cand>();
      const byPartial = new Map<string, Cand[]>();
      for (const c of list) {
        try {
          const st = await fsp.lstat(c.p, { bigint: true });
          if (Number(st.size) !== size || !st.isFile()) continue;
          const inoKey = `${st.dev}:${st.ino}`;
          if (st.ino !== 0n && byIno.has(inoKey)) continue;
          byIno.set(inoKey, c);
          this.state.currentPath = c.p;
          const ph = await this.hashFile(c.p, size > PARTIAL_HASH_BYTES ? PARTIAL_HASH_BYTES : undefined);
          const arr = byPartial.get(ph) ?? [];
          arr.push(c);
          byPartial.set(ph, arr);
        } catch (e) {
          if (e instanceof CancelledError) throw e;
          this.error(c.p, e);
        }
      }
      for (const [ph, arr] of byPartial) {
        if (arr.length < 2) continue;
        if (size <= PARTIAL_HASH_BYTES) stage2.push([size, arr.map((a) => ({ ...a, hash: ph }) as Cand & { hash: string })]);
        else stage2.push([size, arr]);
      }
    }

    // 3. Full SHA-256 for files larger than the partial block.
    const fullBytes = stage2.reduce((a, [s, l]) => a + (s > PARTIAL_HASH_BYTES ? s * l.length : 0), 0);
    this.state.hashTotalBytes = this.state.hashedBytes + fullBytes;
    const out: EngineResult['groups'] = [];
    let gid = 1;
    for (const [size, list] of stage2) {
      const byHash = new Map<string, Cand[]>();
      for (const c of list) {
        let hash = (c as Cand & { hash?: string }).hash;
        if (!hash) {
          try {
            this.state.currentPath = c.p;
            hash = await this.hashFile(c.p);
            const after = await fsp.lstat(c.p);
            if (after.size !== size || Math.abs(after.mtimeMs - c.m) > 2) continue; // changed while scanning
          } catch (e) {
            if (e instanceof CancelledError) throw e;
            this.error(c.p, e);
            continue;
          }
        }
        const arr = byHash.get(hash) ?? [];
        arr.push(c);
        byHash.set(hash, arr);
      }
      for (const [hash, arr] of byHash) {
        if (arr.length < 2) continue;
        const id = gid++;
        const ids: number[] = [];
        for (const c of arr) {
          const it = this.addItem({
            path: c.p, size, mtime: c.m, ctime: c.b, categoryId: 'duplicates', reason: 'reason.duplicate',
            reasonArgs: { count: arr.length }, risk: 'review', isDir: false, personal: c.personal, groupId: id,
          });
          if (it) ids.push(it.id);
        }
        out.push({ id, size, hash, itemIds: ids, keepId: this.pickKeeper(ids) });
      }
    }
    return out;
  }

  /** Chooses which copy is kept by default: personal folders first, then not-in-Downloads, then the oldest. */
  private pickKeeper(ids: number[]): number {
    const byId = new Map(this.items.slice(-ids.length).map((i) => [i.id, i]));
    let best = ids[0];
    let bestScore = -Infinity;
    for (const id of ids) {
      const it = byId.get(id)!;
      const n = this.norm(it.path);
      let score = 0;
      if (it.personal) score += 4;
      if (!this.downloadsNorm.some((d) => isUnder(n, d, this.w))) score += 2;
      score -= it.ctime / 1e15; // older creation date wins ties
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }

  /* ---------------- Disk analyzer ---------------- */

  private async runAnalyze(): Promise<AnalyzerData> {
    const nodes: AnalyzerNode[] = [];
    const ext = new Map<string, { bytes: number; count: number }>();
    let largest: { path: string; size: number; mtime: number }[] = [];
    let largestMin = 0;
    const roots: number[] = [];

    const visitor: Visitor = {
      maxDepth: 4096,
      onEnter: (frame, parent, name, st) => {
        const node: AnalyzerNode = {
          id: nodes.length, parent: parent?.node?.id ?? -1, name: parent ? name : frame.path, size: 0, fileCount: 0,
          dirCount: 0, mtime: st?.mtimeMs ?? 0, childDirs: [], topFiles: [], directFileCount: 0, directFileBytes: 0,
        };
        nodes.push(node);
        frame.node = node;
        if (parent?.node) parent.node.childDirs.push(node.id);
        else roots.push(node.id);
      },
      onFile: (path, name, st, frame) => {
        const node = frame.node!;
        node.directFileCount++;
        node.directFileBytes += st.size;
        node.topFiles.push({ name, size: st.size, mtime: st.mtimeMs });
        if (node.topFiles.length > TOP_FILES_PER_DIR * 2) {
          node.topFiles.sort((a, b) => b.size - a.size);
          node.topFiles.length = TOP_FILES_PER_DIR;
        }
        const e = this.lib.extname(name).toLowerCase() || '(none)';
        const es = ext.get(e) ?? { bytes: 0, count: 0 };
        es.bytes += st.size;
        es.count++;
        ext.set(e, es);
        if (largest.length < LARGEST_FILES || st.size > largestMin) {
          largest.push({ path, size: st.size, mtime: st.mtimeMs });
          if (largest.length > LARGEST_FILES * 2) {
            largest.sort((a, b) => b.size - a.size);
            largest = largest.slice(0, LARGEST_FILES);
            largestMin = largest[largest.length - 1].size;
          }
        }
      },
      onExit: (frame, r) => {
        const node = frame.node;
        if (!node) return;
        node.size = r.size;
        node.fileCount = r.files;
        node.dirCount = r.dirs;
        node.topFiles.sort((a, b) => b.size - a.size);
        if (node.topFiles.length > TOP_FILES_PER_DIR) node.topFiles.length = TOP_FILES_PER_DIR;
      },
    };
    for (const root of this.task.roots) await this.walk(root, visitor);
    largest.sort((a, b) => b.size - a.size);
    return {
      nodes,
      roots,
      extStats: [...ext.entries()].map(([e, v]) => ({ ext: e, ...v })).sort((a, b) => b.bytes - a.bytes),
      largestFiles: largest.slice(0, LARGEST_FILES),
    };
  }

  async run(): Promise<EngineResult> {
    this.state.phase = 'enumerating';
    this.tick();
    let categories: CategoryInfo[] = [];
    let tree: AnalyzerData | null = null;
    if (this.task.kind === 'quick') categories = await this.runQuick();
    else if (this.task.kind === 'analyze') tree = await this.runAnalyze();
    else categories = await this.runFileScan();
    this.state.phase = 'finalizing';
    this.tick();
    for (const [id, n] of this.catInaccessible) {
      const c = categories.find((x) => x.id === id);
      if (c) c.inaccessible += n;
    }
    void this.catLocations;
    return { items: this.items, categories, groups: this.groupsOut, tree, state: this.state, errorSamples: this.errorSamples };
  }
}

export function defaultDetect(kind: ScanKind, partial?: Partial<DeepDetectOptions>): DeepDetectOptions {
  const none: DeepDetectOptions = { large: false, duplicates: false, emptyFolders: false, oldDownloads: false, installers: false, temp: false, caches: false };
  if (kind === 'large') return { ...none, large: true };
  if (kind === 'duplicates') return { ...none, duplicates: true };
  if (kind === 'deep') return { large: true, duplicates: true, emptyFolders: true, oldDownloads: true, installers: true, temp: true, caches: true, ...partial };
  return none;
}

export { nodePath };
