import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScanEngine, CancelledError } from '../electron/scanner/engine';
import { buildQuickTargets } from '../electron/scanner/targets';
import { canSymlink, makeTempDir, protection, runEngine, task, write } from './helpers';

let dir: string;
beforeEach(async () => {
  dir = await makeTempDir();
});
afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('duplicate detection', () => {
  it('groups only byte-identical files using size + SHA-256', async () => {
    const big = crypto.randomBytes(300 * 1024);
    const bigVariant = Buffer.from(big);
    bigVariant[bigVariant.length - 1] ^= 0xff; // same size, same first 64KB, different content
    await write(path.join(dir, 'a', 'photo.jpg'), big);
    await write(path.join(dir, 'b', 'photo-copy.jpg'), big);
    await write(path.join(dir, 'c', 'other-name.bin'), big);
    await write(path.join(dir, 'd', 'variant.jpg'), bigVariant);
    await write(path.join(dir, 'e', 'photo.jpg'), crypto.randomBytes(300 * 1024)); // same name, different content
    await write(path.join(dir, 'small1.txt'), 'hello world');
    await write(path.join(dir, 'small2.txt'), 'hello world');
    await write(path.join(dir, 'small3.txt'), 'hello there'); // same size, different content
    await fsp.link(path.join(dir, 'a', 'photo.jpg'), path.join(dir, 'hardlink.jpg')); // same physical file

    const r = await runEngine(task('duplicates', [dir]));
    const groups = r.groups.map((g) => g.itemIds.map((id) => path.basename(r.items.find((i) => i.id === id)!.path)).sort());
    expect(groups).toHaveLength(2);
    const bigGroup = r.groups.find((g) => g.size === big.length)!;
    expect(bigGroup.itemIds).toHaveLength(3);
    expect(bigGroup.hash).toBe(crypto.createHash('sha256').update(big).digest('hex'));
    expect(groups.flat()).not.toContain('variant.jpg');
    expect(groups.flat()).not.toContain('small3.txt');
    expect(groups.find((g) => g.includes('small1.txt'))).toEqual(['small1.txt', 'small2.txt']);
    expect(r.categories.find((c) => c.id === 'duplicates')!.bytes).toBe(big.length * 2 + 11);
    // keeper is one of the group members
    expect(bigGroup.itemIds).toContain(bigGroup.keepId);
  });
});

describe('deep scan', () => {
  it('detects large files, installers, old downloads, temp files, caches and empty folders', async () => {
    const downloads = path.join(dir, 'Downloads');
    await write(path.join(downloads, 'old-movie.mkv'), Buffer.alloc(10), 200);
    await write(path.join(downloads, 'new.pdf'), Buffer.alloc(10), 1);
    await write(path.join(downloads, 'tool-setup.exe'), Buffer.alloc(10), 60);
    await write(path.join(dir, 'pkgs', 'thing.msi'), Buffer.alloc(10), 60);
    await write(path.join(dir, 'work', 'session.tmp'), 'x', 3);
    await write(path.join(dir, 'work', 'fresh.tmp'), 'x');
    await write(path.join(dir, 'work', 'big.iso'), Buffer.alloc(2048));
    await write(path.join(dir, 'app', 'Cache', 'data_1'), Buffer.alloc(600));
    await write(path.join(dir, 'app', 'Cache', 'sub', 'data_2'), Buffer.alloc(600));
    await fsp.mkdir(path.join(dir, 'empty1', 'nested', 'deeper'), { recursive: true });
    await fsp.mkdir(path.join(dir, 'empty2'));

    const r = await runEngine(
      task('deep', [dir], { largeMinBytes: 1024, cacheMinBytes: 1000, downloadsDirs: [downloads], detect: { large: true, duplicates: false, emptyFolders: true, oldDownloads: true, installers: true, temp: true, caches: true } }),
    );
    const by = (cat: string) => r.items.filter((i) => i.categoryId === cat).map((i) => path.relative(dir, i.path)).sort();
    expect(by('large')).toEqual([path.join('work', 'big.iso')]);
    expect(by('installers')).toEqual([path.join('Downloads', 'tool-setup.exe'), path.join('pkgs', 'thing.msi')]);
    expect(by('oldDownloads')).toEqual([path.join('Downloads', 'old-movie.mkv')]);
    expect(by('tempFiles')).toEqual([path.join('work', 'session.tmp')]);
    expect(by('largeCaches')).toEqual([path.join('app', 'Cache')]);
    expect(r.items.find((i) => i.categoryId === 'largeCaches')!.size).toBe(1200);
    expect(by('emptyFolders')).toEqual(['empty1', 'empty2']); // topmost empty folder only
    expect(r.state.filesScanned).toBe(9);
  });

  it('does not follow symbolic links by default', async (ctx) => {
    if (!(await canSymlink(dir))) return ctx.skip();
    const outside = await makeTempDir('fristy-outside-');
    try {
      await write(path.join(outside, 'huge.bin'), Buffer.alloc(4096));
      await write(path.join(dir, 'real.bin'), Buffer.alloc(4096));
      await fsp.symlink(outside, path.join(dir, 'link-to-outside'), 'dir');
      await fsp.symlink(path.join(dir, 'real.bin'), path.join(dir, 'file-link.bin'));
      const r = await runEngine(task('large', [dir], { largeMinBytes: 1024 }));
      expect(r.items.map((i) => path.basename(i.path))).toEqual(['real.bin']);
      expect(r.state.skippedLinks).toBe(2);
    } finally {
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });

  it('never reports protected or excluded files', async () => {
    await write(path.join(dir, 'keep', 'big.bin'), Buffer.alloc(4096));
    await write(path.join(dir, 'ntuser.dat'), Buffer.alloc(4096));
    await write(path.join(dir, 'ok.bin'), Buffer.alloc(4096));
    const r = await runEngine(task('large', [dir], { largeMinBytes: 1024, protection: protection('/x', [path.join(dir, 'keep')]) }));
    expect(r.items.map((i) => path.basename(i.path))).toEqual(['ok.bin']);
  });

  it('marks files in personal folders and never auto-flags them as safe', async () => {
    const home = dir;
    await write(path.join(home, 'Documents', 'report.tmp'), 'x', 10);
    const r = await runEngine(task('deep', [home], { protection: protection(home) }));
    const it = r.items.find((i) => i.path.endsWith('report.tmp'))!;
    expect(it.personal).toBe(true);
    expect(it.risk).toBe('review');
  });
});

describe('quick scan', () => {
  it('scans target folders, honours minimum age and file patterns', async () => {
    const temp = path.join(dir, 'Temp');
    await write(path.join(temp, 'old.tmp'), 'abc', 3);
    await write(path.join(temp, 'sub', 'old2.dat'), 'abcd', 3);
    await write(path.join(temp, 'recent.tmp'), 'x');
    await write(path.join(dir, 'logs', 'app.log'), 'l', 40);
    await write(path.join(dir, 'logs', 'app.log.1'), 'll', 40);
    await write(path.join(dir, 'logs', 'new.log'), 'l', 2);
    await write(path.join(dir, 'logs', 'data.db'), 'l', 40);
    const targets = [
      { categoryId: 'userTemp', paths: [temp, path.join(dir, 'missing')], namePatterns: [], minAgeHours: 24, maxDepth: 10, risk: 'safe' as const, autoSelect: true, reason: 'r' },
      { categoryId: 'oldLogs', paths: [path.join(dir, 'logs')], namePatterns: ['\\.log(\\.\\d+)?$'], minAgeHours: 24 * 30, maxDepth: 3, risk: 'review' as const, autoSelect: true, reason: 'r' },
    ];
    const r = await runEngine(task('quick', [], { targets }));
    const tempCat = r.categories.find((c) => c.id === 'userTemp')!;
    expect(tempCat.count).toBe(2);
    expect(tempCat.bytes).toBe(7);
    expect(tempCat.locations).toEqual([temp]);
    expect(r.categories.find((c) => c.id === 'oldLogs')!.count).toBe(2);
    expect(r.state.errors).toBe(0);
  });

  it('builds Windows targets that never point into browser profile data', () => {
    const t = buildQuickTargets({ windows: true, skipRecentHours: 24, env: { LOCALAPPDATA: 'C:\\U\\AppData\\Local', APPDATA: 'C:\\U\\AppData\\Roaming', SystemRoot: 'C:\\Windows', TEMP: 'C:\\U\\AppData\\Local\\Temp' } });
    const browser = t.find((x) => x.categoryId === 'browserCache')!;
    for (const p of browser.paths) expect(p).toMatch(/(Cache|cache2|startupCache|CacheData|GPUCache)$/i);
    const user = t.find((x) => x.categoryId === 'userTemp')!;
    expect(user.paths).toEqual(['C:\\U\\AppData\\Local\\Temp']);
  });
});

describe('scan control', () => {
  it('supports pause, resume and cancel through checkpoints', async () => {
    for (let i = 0; i < 30; i++) await write(path.join(dir, `d${i}`, 'f.bin'), Buffer.alloc(10));
    let calls = 0;
    let resume!: () => void;
    let pausedSeen = false;
    const engine = new ScanEngine(task('large', [dir], { largeMinBytes: 1 }), {
      progress: () => {},
      checkpoint: async () => {
        calls++;
        if (calls === 5) {
          pausedSeen = true;
          await new Promise<void>((r) => (resume = r));
        }
      },
    });
    const p = engine.run();
    await new Promise((r) => setTimeout(r, 50));
    expect(pausedSeen).toBe(true);
    const before = engine.state.filesScanned;
    await new Promise((r) => setTimeout(r, 50));
    expect(engine.state.filesScanned).toBe(before); // nothing happens while paused
    resume();
    const res = await p;
    expect(res.items).toHaveLength(30);

    let n = 0;
    const cancelling = new ScanEngine(task('large', [dir], { largeMinBytes: 1 }), {
      progress: () => {},
      checkpoint: async () => {
        if (++n > 3) throw new CancelledError();
      },
    });
    await expect(cancelling.run()).rejects.toBeInstanceOf(CancelledError);
  });
});
