/**
 * Safe cleaning pipeline. Pure Node (the Recycle Bin operation is injected) so it can be tested
 * against temporary directories.
 *
 * Every item is re-validated immediately before removal:
 *  - the protection rules (including current exclusions) are evaluated again,
 *  - the path must still exist and must not be a symbolic link / junction,
 *  - the real path must equal the scanned path (no link anywhere in the parent chain),
 *  - files must have the same size and modification time as when they were scanned,
 *  - folders reported as empty must still be empty,
 *  - files locked by another process are skipped,
 *  - at least one copy of every duplicate group must remain on disk.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { promisify } from 'node:util';

/** OS-level real path resolution (GetFinalPathNameByHandle on Windows: resolves junctions too). */
const realpathNative = promisify(fs.realpath.native);
import type { CleanItemResult, CleanMode, CleanProgress, ResultItem } from '../src/shared/types';
import { classifyPath, normalizeForCompare, type ProtectionConfig } from './protection';

export interface CleanDeps {
  /** Moves a path to the Recycle Bin (Electron shell.trashItem in production). */
  trash(path: string): Promise<void>;
  protection: ProtectionConfig;
  onProgress?(p: CleanProgress): void;
  /** Directory items that are whole folders (large caches) may be removed recursively. */
  allowRecursiveCategories?: string[];
}

export interface CleanOutcome {
  results: CleanItemResult[];
  removed: number;
  failed: number;
  skipped: number;
  bytes: number;
}

export interface GroupInfo {
  itemIds: number[];
}

async function isRecursivelyEmpty(dir: string, budget = { n: 10000 }): Promise<boolean> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (--budget.n < 0) return false;
    if (!e.isDirectory() || e.isSymbolicLink()) return false;
    if (!(await isRecursivelyEmpty(`${dir}${dir.includes('\\') ? '\\' : '/'}${e.name}`, budget))) return false;
  }
  return true;
}

async function isLocked(path: string): Promise<boolean> {
  try {
    const fh = await fsp.open(path, fs.constants.O_RDWR);
    await fh.close();
    return false;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'EBUSY' || code === 'ETXTBSY';
  }
}

/** Returns null when the item may be removed, otherwise an i18n error key. */
export async function revalidate(item: ResultItem, deps: CleanDeps): Promise<string | null> {
  const cfg = deps.protection;
  const verdict = classifyPath(item.path, cfg);
  if (verdict.blocked) return 'clean.err.protected';

  let st: fs.Stats;
  try {
    st = await fsp.lstat(item.path);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'clean.err.missing' : 'clean.err.inaccessible';
  }
  if (st.isSymbolicLink()) return 'clean.err.link';
  if (item.isDir !== st.isDirectory()) return 'clean.err.changed';
  if (!item.isDir && !st.isFile()) return 'clean.err.changed';

  try {
    const real = await realpathNative(item.path);
    if (normalizeForCompare(real, cfg.windows) !== normalizeForCompare(item.path, cfg.windows)) return 'clean.err.redirected';
    if (classifyPath(real, cfg).blocked) return 'clean.err.protected';
  } catch {
    return 'clean.err.inaccessible';
  }

  if (!item.isDir) {
    if (st.size !== item.size || Math.abs(st.mtimeMs - item.mtime) > 2) return 'clean.err.changed';
    if (await isLocked(item.path)) return 'clean.err.inUse';
  } else if (item.categoryId === 'emptyFolders') {
    try {
      if (!(await isRecursivelyEmpty(item.path))) return 'clean.err.notEmpty';
    } catch {
      return 'clean.err.inaccessible';
    }
  } else if (!(deps.allowRecursiveCategories ?? ['largeCaches']).includes(item.categoryId)) {
    return 'clean.err.changed';
  }
  return null;
}

async function survivorExists(item: ResultItem): Promise<boolean> {
  try {
    const st = await fsp.lstat(item.path);
    return st.isFile() && !st.isSymbolicLink() && st.size === item.size;
  } catch {
    return false;
  }
}

/**
 * Removes the selected items. `allItems` must contain every item of the scan session so duplicate
 * groups can be checked for a surviving copy.
 */
export async function executeClean(
  selected: ResultItem[],
  allItems: Map<number, ResultItem>,
  groups: Map<number, GroupInfo>,
  mode: CleanMode,
  deps: CleanDeps,
): Promise<CleanOutcome> {
  const results: CleanItemResult[] = [];
  let removed = 0;
  let failed = 0;
  let skipped = 0;
  let bytes = 0;

  // De-duplicate by path (an item can be listed in two categories, e.g. duplicate + old download).
  const seen = new Set<string>();
  const unique: ResultItem[] = [];
  for (const it of selected) {
    const k = normalizeForCompare(it.path, deps.protection.windows);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(it);
  }
  const selectedPaths = seen;

  // Duplicate groups: never remove the last copy.
  const blockedIds = new Map<number, string>();
  const byGroup = new Map<number, ResultItem[]>();
  for (const it of unique) {
    if (it.groupId == null) continue;
    const arr = byGroup.get(it.groupId) ?? [];
    arr.push(it);
    byGroup.set(it.groupId, arr);
  }
  for (const [gid, sel] of byGroup) {
    const g = groups.get(gid);
    const members = (g?.itemIds ?? []).map((id) => allItems.get(id)).filter((x): x is ResultItem => !!x);
    const remaining = members.filter((m) => !selectedPaths.has(normalizeForCompare(m.path, deps.protection.windows)));
    if (remaining.length === 0) {
      // Keep the first selected copy.
      blockedIds.set(sel[0].id, 'clean.err.lastCopy');
      remaining.push(sel[0]);
    }
    let anySurvivor = false;
    for (const r of remaining) if (await survivorExists(r)) anySurvivor = true;
    if (!anySurvivor) for (const s of sel) if (!blockedIds.has(s.id)) blockedIds.set(s.id, 'clean.err.noSurvivingCopy');
  }

  // Files first, folders last.
  unique.sort((a, b) => Number(a.isDir) - Number(b.isDir));
  const total = unique.length;
  let done = 0;
  let lastEmit = 0;

  for (const it of unique) {
    const base = { path: it.path, size: it.size, categoryId: it.categoryId };
    let err: string | null = blockedIds.get(it.id) ?? null;
    if (!err) err = await revalidate(it, deps);
    if (err) {
      skipped++;
      results.push({ ...base, status: 'skipped', error: err });
    } else {
      try {
        if (mode === 'trash') await deps.trash(it.path);
        else await fsp.rm(it.path, { recursive: it.isDir, force: false });
        removed++;
        bytes += it.size;
        results.push({ ...base, status: mode === 'trash' ? 'recycled' : 'deleted' });
      } catch (e) {
        failed++;
        results.push({ ...base, status: 'failed', error: (e as Error).message || 'clean.err.unknown' });
      }
    }
    done++;
    const now = Date.now();
    if (deps.onProgress && (now - lastEmit > 100 || done === total)) {
      lastEmit = now;
      deps.onProgress({ done, total, bytes, current: it.path });
    }
  }
  return { results, removed, failed, skipped, bytes };
}
