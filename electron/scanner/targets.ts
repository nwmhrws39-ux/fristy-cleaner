/**
 * Known locations for Quick Scan / Temporary File categories.
 * Pure data built from environment variables, so it can be tested on any OS.
 */
import nodePath from 'node:path';
import os from 'node:os';
import type { RiskLevel } from '../../src/shared/types';
import type { EnvLike } from '../protection';

export interface QuickTarget {
  categoryId: string;
  /** Paths may contain a `*` segment that is expanded to every sub folder (e.g. browser profiles). */
  paths: string[];
  /** Regular expressions (case-insensitive) matched against the file name. Empty = every file. */
  namePatterns: string[];
  /** Files modified more recently than this are skipped (probably in use). */
  minAgeHours: number;
  maxDepth: number;
  risk: RiskLevel;
  autoSelect: boolean;
  reason: string;
}

export const QUICK_CATEGORY_ORDER = [
  'windowsTemp', 'userTemp', 'appCache', 'browserCache', 'thumbnails', 'crashDumps', 'oldLogs', 'recycleBin',
] as const;

/** Categories shown on the Temporary Files page. */
export const TEMP_CATEGORY_IDS = ['windowsTemp', 'userTemp', 'appCache', 'browserCache', 'thumbnails', 'crashDumps', 'oldLogs'];

const CHROMIUM_CACHE_SUBDIRS = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnWebGPUCache', 'DawnGraphiteCache'];

function chromium(userData: string): string[] {
  return [
    ...CHROMIUM_CACHE_SUBDIRS.map((d) => nodePath.win32.join(userData, '*', d)),
    nodePath.win32.join(userData, 'ShaderCache'),
    nodePath.win32.join(userData, 'GrShaderCache'),
    nodePath.win32.join(userData, 'GraphiteDawnCache'),
  ];
}

export function buildQuickTargets(opts: { windows: boolean; env: EnvLike; skipRecentHours: number }): QuickTarget[] {
  const recent = Math.max(0, opts.skipRecentHours);
  const t = (categoryId: string, paths: (string | undefined)[], extra: Partial<QuickTarget> = {}): QuickTarget => ({
    categoryId,
    paths: Array.from(new Set(paths.filter((p): p is string => !!p))),
    namePatterns: [],
    minAgeHours: recent,
    maxDepth: 32,
    risk: 'safe',
    autoSelect: true,
    reason: `reason.${categoryId}`,
    ...extra,
  });

  if (!opts.windows) {
    const home = opts.env.HOME || os.homedir();
    return [
      t('userTemp', [os.tmpdir()]),
      t('appCache', [nodePath.posix.join(home, '.cache')]),
      t('browserCache', [nodePath.posix.join(home, '.config', 'google-chrome', '*', 'Cache')]),
      t('thumbnails', [nodePath.posix.join(home, '.cache', 'thumbnails')], { minAgeHours: 0 }),
      t('oldLogs', [nodePath.posix.join(home, '.local', 'share')], {
        namePatterns: ['\\.log(\\.\\d+)?$'], minAgeHours: 24 * 30, maxDepth: 5, risk: 'review',
      }),
    ];
  }

  const w = nodePath.win32;
  const env = opts.env;
  const sysRoot = env.SystemRoot || env.windir || 'C:\\Windows';
  const local = env.LOCALAPPDATA || (env.USERPROFILE ? w.join(env.USERPROFILE, 'AppData', 'Local') : undefined);
  const roaming = env.APPDATA || (env.USERPROFILE ? w.join(env.USERPROFILE, 'AppData', 'Roaming') : undefined);
  const programData = env.ProgramData || 'C:\\ProgramData';
  const j = (base: string | undefined, ...parts: string[]) => (base ? w.join(base, ...parts) : undefined);

  return [
    t('windowsTemp', [w.join(sysRoot, 'Temp')]),
    t('userTemp', [env.TEMP, env.TMP, j(local, 'Temp')]),
    t('appCache', [
      j(local, 'D3DSCache'),
      j(local, 'NVIDIA', 'DXCache'),
      j(local, 'NVIDIA', 'GLCache'),
      j(local, 'AMD', 'DxCache'),
      j(local, 'AMD', 'DxcCache'),
      j(local, 'AMD', 'GLCache'),
      j(local, 'Microsoft', 'Windows', 'INetCache'),
      j(roaming, 'discord', 'Cache'),
      j(roaming, 'discord', 'Code Cache'),
      j(roaming, 'discord', 'GPUCache'),
      j(roaming, 'Code', 'Cache'),
      j(roaming, 'Code', 'CachedData'),
      j(roaming, 'Code', 'GPUCache'),
      j(roaming, 'Slack', 'Cache'),
      j(roaming, 'Slack', 'Code Cache'),
      j(local, 'Spotify', 'Data'),
      j(local, 'pip', 'cache'),
    ]),
    t('browserCache', [
      ...(local ? chromium(w.join(local, 'Google', 'Chrome', 'User Data')) : []),
      ...(local ? chromium(w.join(local, 'Microsoft', 'Edge', 'User Data')) : []),
      ...(local ? chromium(w.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')) : []),
      ...(local ? chromium(w.join(local, 'Vivaldi', 'User Data')) : []),
      j(local, 'Opera Software', 'Opera Stable', 'Cache'),
      j(local, 'Opera Software', 'Opera GX Stable', 'Cache'),
      j(local, 'Mozilla', 'Firefox', 'Profiles', '*', 'cache2'),
      j(local, 'Mozilla', 'Firefox', 'Profiles', '*', 'startupCache'),
    ]),
    t('thumbnails', [j(local, 'Microsoft', 'Windows', 'Explorer')], {
      namePatterns: ['^thumbcache_.*\\.db$', '^iconcache_.*\\.db$'], minAgeHours: 0, maxDepth: 0,
    }),
    t('crashDumps', [
      j(local, 'CrashDumps'),
      w.join(sysRoot, 'Minidump'),
      w.join(programData, 'Microsoft', 'Windows', 'WER', 'ReportArchive'),
      w.join(programData, 'Microsoft', 'Windows', 'WER', 'ReportQueue'),
      j(local, 'Microsoft', 'Windows', 'WER', 'ReportArchive'),
      j(local, 'Microsoft', 'Windows', 'WER', 'ReportQueue'),
    ]),
    t('oldLogs', [local, roaming], {
      namePatterns: ['\\.log(\\.\\d+)?$', '\\.log\\.old$'], minAgeHours: 24 * 30, maxDepth: 6, risk: 'review',
    }),
  ];
}
