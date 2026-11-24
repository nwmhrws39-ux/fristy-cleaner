import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildProtectionConfig } from '../electron/protection';
import { ScanEngine, defaultDetect, type EngineTask } from '../electron/scanner/engine';
import type { ScanKind } from '../src/shared/types';

export async function makeTempDir(prefix = 'fristy-test-'): Promise<string> {
  // Native real path: expands Windows 8.3 short names in %TEMP%.
  return promisify(fs.realpath.native)(await fsp.mkdtemp(path.join(os.tmpdir(), prefix)));
}

export async function write(file: string, content: string | Buffer, ageDays = 0) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content);
  if (ageDays) {
    const t = new Date(Date.now() - ageDays * 86400_000);
    await fsp.utimes(file, t, t);
  }
}

export function protection(home: string, exclusions: string[] = []) {
  return buildProtectionConfig({ windows: process.platform === 'win32', env: { ...process.env, HOME: home, USERPROFILE: home }, exclusions });
}

export function task(kind: ScanKind, roots: string[], over: Partial<EngineTask> = {}): EngineTask {
  return {
    scanId: 't',
    kind,
    roots,
    detect: defaultDetect(kind),
    largeMinBytes: 100 * 1024 * 1024,
    dupMinBytes: 1,
    cacheMinBytes: 100 * 1024 * 1024,
    protection: protection('/nonexistent-home'),
    followLinks: false,
    skipRecentHours: 24,
    oldDownloadDays: 90,
    installerDays: 30,
    downloadsDirs: [],
    noEmptyFolderRoots: [],
    cloudRoots: [],
    skipCloudHashing: true,
    expectedBytes: null,
    ageUsesCreationTime: false,
    now: Date.now(),
    ...over,
  };
}

export async function runEngine(t: EngineTask) {
  const engine = new ScanEngine(t, { progress: () => {}, checkpoint: async () => {} });
  return engine.run();
}

export const exists = (p: string) => fs.existsSync(p);

/** Creating symbolic links on Windows needs Developer Mode or admin rights; such tests are skipped otherwise. */
export async function canSymlink(dir: string): Promise<boolean> {
  try {
    await fsp.symlink(path.join(dir, 'x'), path.join(dir, '.symlink-probe'));
    await fsp.unlink(path.join(dir, '.symlink-probe'));
    return true;
  } catch {
    return false;
  }
}
