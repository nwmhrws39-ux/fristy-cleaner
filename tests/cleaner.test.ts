import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeClean, type CleanDeps } from '../electron/cleaner';
import type { ResultItem } from '../src/shared/types';
import { exists, makeTempDir, protection, runEngine, task, write } from './helpers';

let dir: string;
let bin: string;
let deps: CleanDeps;
const trashed: string[] = [];

beforeEach(async () => {
  dir = await makeTempDir();
  bin = await makeTempDir('fristy-bin-');
  trashed.length = 0;
  deps = {
    protection: protection('/nonexistent-home'),
    // Test double for the Recycle Bin: moves the file into a separate folder.
    trash: async (p) => {
      trashed.push(p);
      await fsp.rename(p, path.join(bin, `${trashed.length}-${path.basename(p)}`));
    },
  };
});
afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.rm(bin, { recursive: true, force: true });
});

const byId = (items: ResultItem[]) => new Map(items.map((i) => [i.id, i]));

describe('safe cleaning', () => {
  it('moves selected files to the recycle bin and reports exact bytes', async () => {
    await write(path.join(dir, 'a.tmp'), 'aaaa', 5);
    await write(path.join(dir, 'b.tmp'), 'bbbbbb', 5);
    await write(path.join(dir, 'keep.txt'), 'keep');
    const r = await runEngine(task('deep', [dir]));
    const sel = r.items.filter((i) => i.categoryId === 'tempFiles');
    expect(sel).toHaveLength(2);
    const out = await executeClean(sel, byId(r.items), new Map(), 'trash', deps);
    expect(out.removed).toBe(2);
    expect(out.bytes).toBe(10);
    expect(out.results.every((x) => x.status === 'recycled')).toBe(true);
    expect(exists(path.join(dir, 'a.tmp'))).toBe(false);
    expect(exists(path.join(dir, 'keep.txt'))).toBe(true);
    expect((await fsp.readdir(bin)).length).toBe(2);
  });

  it('skips files that changed, disappeared or were replaced by links after the scan', async () => {
    await write(path.join(dir, 'changed.tmp'), 'v1', 5);
    await write(path.join(dir, 'gone.tmp'), 'x', 5);
    await write(path.join(dir, 'swapped.tmp'), 'x', 5);
    const victim = await makeTempDir('fristy-victim-');
    await write(path.join(victim, 'important.doc'), 'precious');
    const r = await runEngine(task('deep', [dir]));
    await fsp.writeFile(path.join(dir, 'changed.tmp'), 'version2');
    await fsp.rm(path.join(dir, 'gone.tmp'));
    await fsp.rm(path.join(dir, 'swapped.tmp'));
    await fsp.symlink(path.join(victim, 'important.doc'), path.join(dir, 'swapped.tmp'));
    const out = await executeClean(r.items, byId(r.items), new Map(), 'trash', deps);
    const status = Object.fromEntries(out.results.map((x) => [path.basename(x.path), x.error]));
    expect(status['changed.tmp']).toBe('clean.err.changed');
    expect(status['gone.tmp']).toBe('clean.err.missing');
    expect(status['swapped.tmp']).toBe('clean.err.link');
    expect(out.removed).toBe(0);
    expect(trashed).toHaveLength(0);
    expect(exists(path.join(victim, 'important.doc'))).toBe(true);
    await fsp.rm(victim, { recursive: true, force: true });
  });

  it('refuses paths redirected through a linked parent folder', async () => {
    await write(path.join(dir, 'work', 'x.tmp'), 'x', 5);
    const r = await runEngine(task('deep', [dir]));
    const victim = await makeTempDir('fristy-victim-');
    await write(path.join(victim, 'x.tmp'), 'x', 5);
    const st = await fsp.stat(path.join(dir, 'work', 'x.tmp'));
    await fsp.utimes(path.join(victim, 'x.tmp'), st.atime, st.mtime);
    await fsp.rm(path.join(dir, 'work'), { recursive: true });
    await fsp.symlink(victim, path.join(dir, 'work'), 'dir');
    const out = await executeClean(r.items, byId(r.items), new Map(), 'trash', deps);
    expect(out.results[0].error).toBe('clean.err.redirected');
    expect(exists(path.join(victim, 'x.tmp'))).toBe(true);
    await fsp.rm(victim, { recursive: true, force: true });
  });

  it('always keeps at least one copy of a duplicate group', async () => {
    await write(path.join(dir, 'one.bin'), 'same-content');
    await write(path.join(dir, 'two.bin'), 'same-content');
    await write(path.join(dir, 'three.bin'), 'same-content');
    const r = await runEngine(task('duplicates', [dir]));
    const g = r.groups[0];
    const groups = new Map(r.groups.map((x) => [x.id, { itemIds: x.itemIds }]));
    const out = await executeClean(r.items, byId(r.items), groups, 'trash', deps); // user selected every copy
    expect(out.removed).toBe(2);
    expect(out.results.filter((x) => x.error === 'clean.err.lastCopy')).toHaveLength(1);
    expect((await fsp.readdir(dir)).length).toBe(1);
    expect(g.itemIds).toHaveLength(3);
  });

  it('does not remove duplicates when the kept copy no longer exists', async () => {
    await write(path.join(dir, 'one.bin'), 'same-content');
    await write(path.join(dir, 'two.bin'), 'same-content');
    const r = await runEngine(task('duplicates', [dir]));
    const groups = new Map(r.groups.map((x) => [x.id, { itemIds: x.itemIds }]));
    const keep = r.items.find((i) => i.id === r.groups[0].keepId)!;
    const other = r.items.find((i) => i.id !== keep.id)!;
    await fsp.rm(keep.path);
    const out = await executeClean([other], byId(r.items), groups, 'trash', deps);
    expect(out.results[0].error).toBe('clean.err.noSurvivingCopy');
    expect(exists(other.path)).toBe(true);
  });

  it('re-checks protection rules (exclusions added after the scan)', async () => {
    await write(path.join(dir, 'x.tmp'), 'x', 5);
    const r = await runEngine(task('deep', [dir]));
    const out = await executeClean(r.items, byId(r.items), new Map(), 'trash', { ...deps, protection: protection('/h', [dir]) });
    expect(out.results[0].error).toBe('clean.err.protected');
    expect(exists(path.join(dir, 'x.tmp'))).toBe(true);
  });

  it('removes empty folders only while they are still empty', async () => {
    await fsp.mkdir(path.join(dir, 'e1', 'inner'), { recursive: true });
    await fsp.mkdir(path.join(dir, 'e2'));
    await write(path.join(dir, 'file.txt'), 'x');
    const r = await runEngine(task('deep', [dir]));
    const empties = r.items.filter((i) => i.categoryId === 'emptyFolders');
    expect(empties).toHaveLength(2);
    await write(path.join(dir, 'e2', 'new.txt'), 'new');
    const out = await executeClean(empties, byId(r.items), new Map(), 'trash', deps);
    expect(exists(path.join(dir, 'e1'))).toBe(false);
    expect(exists(path.join(dir, 'e2', 'new.txt'))).toBe(true);
    expect(out.results.find((x) => x.path.endsWith('e2'))!.error).toBe('clean.err.notEmpty');
  });

  it('supports explicit permanent deletion', async () => {
    await write(path.join(dir, 'p.tmp'), 'xyz', 5);
    const r = await runEngine(task('deep', [dir]));
    const out = await executeClean(r.items, byId(r.items), new Map(), 'permanent', deps);
    expect(out.results[0].status).toBe('deleted');
    expect(trashed).toHaveLength(0);
    expect(exists(path.join(dir, 'p.tmp'))).toBe(false);
  });

  it('reports recycle bin failures without falling back to permanent deletion', async () => {
    await write(path.join(dir, 'f.tmp'), 'xyz', 5);
    const r = await runEngine(task('deep', [dir]));
    const out = await executeClean(r.items, byId(r.items), new Map(), 'trash', { ...deps, trash: async () => { throw new Error('Recycle Bin unavailable'); } });
    expect(out.failed).toBe(1);
    expect(out.results[0].error).toBe('Recycle Bin unavailable');
    expect(exists(path.join(dir, 'f.tmp'))).toBe(true);
  });
});
