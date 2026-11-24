/**
 * File protection rules. Pure logic (no Electron imports) so it can be unit tested and used
 * from both the main process and the scanner worker.
 *
 * Verdicts are decided by the longest matching path prefix rule, with exclusions and
 * name-based rules always winning.
 */
import nodePath from 'node:path';

export type RuleVerdict = 'block' | 'allow' | 'personal' | 'browser';

export interface ProtectionRule {
  prefix: string;
  verdict: RuleVerdict;
  reason: string;
}

export interface ProtectionConfig {
  windows: boolean;
  rules: ProtectionRule[];
  /** User exclusions. Always blocked, never scanned. */
  exclusions: string[];
  /** Folder names inside browser profiles that only contain disposable cache data. */
  browserCacheDirs: string[];
  /** File names that are always blocked, anywhere (registry hives, boot files...). */
  blockedFileNames: string[];
  /** Path segments that are always blocked, anywhere. */
  blockedSegments: string[];
}

export interface ProtectionVerdict {
  blocked: boolean;
  reason?: string;
  personal: boolean;
}

type PathLib = typeof nodePath.win32;

export function pathLib(cfg: Pick<ProtectionConfig, 'windows'>): PathLib {
  return cfg.windows ? nodePath.win32 : nodePath.posix;
}

/** Normalises a path for comparison: absolute, no trailing separator, lower case on Windows. */
export function normalizeForCompare(p: string, windows: boolean): string {
  const lib = windows ? nodePath.win32 : nodePath.posix;
  let n = lib.resolve(p);
  if (windows) {
    if (n.startsWith('\\\\?\\')) n = n.slice(4);
    n = n.toLowerCase();
  }
  const root = lib.parse(n).root;
  while (n.length > root.length && (n.endsWith('\\') || n.endsWith('/'))) n = n.slice(0, -1);
  return n;
}

export function isUnder(child: string, parent: string, windows: boolean): boolean {
  const sep = windows ? '\\' : '/';
  if (child === parent) return true;
  const p = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(p);
}

export function compileConfig(cfg: ProtectionConfig): ProtectionConfig {
  const w = cfg.windows;
  return {
    ...cfg,
    rules: cfg.rules
      .filter((r) => r.prefix)
      .map((r) => ({ ...r, prefix: normalizeForCompare(r.prefix, w) }))
      .sort((a, b) => b.prefix.length - a.prefix.length),
    exclusions: cfg.exclusions.filter(Boolean).map((e) => normalizeForCompare(e, w)),
    browserCacheDirs: cfg.browserCacheDirs.map((d) => d.toLowerCase()),
    blockedFileNames: cfg.blockedFileNames.map((d) => d.toLowerCase()),
    blockedSegments: cfg.blockedSegments.map((d) => d.toLowerCase()),
  };
}

export function isExcluded(p: string, cfg: ProtectionConfig): boolean {
  const n = normalizeForCompare(p, cfg.windows);
  return cfg.exclusions.some((e) => isUnder(n, e, cfg.windows));
}

/**
 * Decides whether a path may be offered for removal.
 * `cfg` must have been passed through compileConfig().
 */
export function classifyPath(p: string, cfg: ProtectionConfig): ProtectionVerdict {
  const w = cfg.windows;
  const n = normalizeForCompare(p, w);
  const lib = pathLib(cfg);
  const sep = w ? '\\' : '/';

  if (cfg.exclusions.some((e) => isUnder(n, e, w))) return { blocked: true, reason: 'protect.excluded', personal: false };

  const root = lib.parse(n).root;
  if (n === root) return { blocked: true, reason: 'protect.driveRoot', personal: false };

  const segments = n.slice(root.length).split(sep).filter(Boolean);
  const lowerSegments = w ? segments : segments.map((s) => s.toLowerCase());
  for (const s of lowerSegments) {
    if (cfg.blockedSegments.includes(s)) return { blocked: true, reason: 'protect.system', personal: false };
  }
  const name = lowerSegments[lowerSegments.length - 1] ?? '';
  if (cfg.blockedFileNames.some((b) => (b.endsWith('*') ? name.startsWith(b.slice(0, -1)) : name === b))) {
    return { blocked: true, reason: 'protect.criticalFile', personal: false };
  }
  // Files directly in a drive root (bootmgr, pagefile.sys, ...) are never touched.
  if (segments.length === 1 && w) return { blocked: true, reason: 'protect.boot', personal: false };

  const rule = cfg.rules.find((r) => isUnder(n, r.prefix, w));
  if (!rule) return { blocked: false, personal: false };

  switch (rule.verdict) {
    case 'block':
      return { blocked: true, reason: rule.reason, personal: false };
    case 'allow':
      return { blocked: false, personal: false };
    case 'personal':
      return { blocked: false, personal: true, reason: rule.reason };
    case 'browser': {
      // Inside a browser profile store: only known cache folders are allowed.
      const rest = n.slice(rule.prefix.length).split(sep).filter(Boolean);
      const inCache = rest.some((seg) => cfg.browserCacheDirs.includes(seg.toLowerCase()));
      if (inCache) return { blocked: false, personal: false };
      return { blocked: true, reason: 'protect.browserProfile', personal: false };
    }
  }
}

/* ---------- Building the configuration for the current machine ---------- */

export interface EnvLike {
  [k: string]: string | undefined;
}

export const BROWSER_CACHE_DIRS = [
  'cache', 'cache_data', 'code cache', 'gpucache', 'cache2', 'shadercache', 'grshadercache', 'dawncache',
  'dawnwebgpucache', 'dawngraphitecache', 'graphitedawncache', 'jumplisticonsold', 'startupcache',
];

export function buildWindowsRules(env: EnvLike): ProtectionRule[] {
  const w = nodePath.win32;
  const sysDrive = (env.SystemDrive || 'C:') + '\\';
  const sysRoot = env.SystemRoot || env.windir || w.join(sysDrive, 'Windows');
  const user = env.USERPROFILE || w.join(sysDrive, 'Users', env.USERNAME || 'User');
  const local = env.LOCALAPPDATA || w.join(user, 'AppData', 'Local');
  const roaming = env.APPDATA || w.join(user, 'AppData', 'Roaming');
  const programData = env.ProgramData || w.join(sysDrive, 'ProgramData');
  const r = (prefix: string | undefined, verdict: RuleVerdict, reason: string): ProtectionRule | null =>
    prefix ? { prefix, verdict, reason } : null;

  const rules: (ProtectionRule | null)[] = [
    // Operating system
    r(sysRoot, 'block', 'protect.system'),
    r(w.join(sysRoot, 'System32'), 'block', 'protect.system32'),
    r(w.join(sysRoot, 'SysWOW64'), 'block', 'protect.system32'),
    r(w.join(sysRoot, 'WinSxS'), 'block', 'protect.system'),
    r(w.join(sysRoot, 'Temp'), 'allow', ''),
    r(w.join(sysRoot, 'Minidump'), 'allow', ''),
    r(w.join(sysDrive, 'Boot'), 'block', 'protect.boot'),
    r(w.join(sysDrive, 'EFI'), 'block', 'protect.boot'),
    r(w.join(sysDrive, 'Recovery'), 'block', 'protect.boot'),
    r(w.join(sysDrive, '$WinREAgent'), 'block', 'protect.boot'),
    r(w.join(sysDrive, 'Config.Msi'), 'block', 'protect.system'),
    r(w.join(sysDrive, 'Windows.old'), 'block', 'protect.system'),
    // Installed applications (use the official uninstaller instead)
    r(env.ProgramFiles, 'block', 'protect.programFiles'),
    r(env['ProgramFiles(x86)'], 'block', 'protect.programFiles'),
    r(env.ProgramW6432, 'block', 'protect.programFiles'),
    r(w.join(sysDrive, 'Program Files'), 'block', 'protect.programFiles'),
    r(w.join(sysDrive, 'Program Files (x86)'), 'block', 'protect.programFiles'),
    r(programData, 'block', 'protect.programData'),
    r(w.join(programData, 'Microsoft', 'Windows', 'WER', 'ReportArchive'), 'allow', ''),
    r(w.join(programData, 'Microsoft', 'Windows', 'WER', 'ReportQueue'), 'allow', ''),
    // User profile internals
    r(w.join(roaming, 'Microsoft'), 'block', 'protect.userSystem'),
    r(w.join(local, 'Microsoft'), 'block', 'protect.userSystem'),
    r(w.join(local, 'Microsoft', 'Windows', 'INetCache'), 'allow', ''),
    r(w.join(local, 'Microsoft', 'Windows', 'Explorer'), 'allow', ''),
    r(w.join(local, 'Microsoft', 'Windows', 'WER'), 'allow', ''),
    r(w.join(local, 'Packages'), 'block', 'protect.storeApps'),
    r(w.join(local, 'Programs'), 'block', 'protect.programFiles'),
    r(w.join(user, 'AppData', 'LocalLow'), 'block', 'protect.gameSaves'),
    // Game saves
    r(w.join(user, 'Saved Games'), 'block', 'protect.gameSaves'),
    r(w.join(user, 'Documents', 'My Games'), 'block', 'protect.gameSaves'),
    r(w.join(roaming, '.minecraft', 'saves'), 'block', 'protect.gameSaves'),
    // Browser profiles: only cache sub folders may be cleaned
    r(w.join(local, 'Google', 'Chrome', 'User Data'), 'browser', ''),
    r(w.join(local, 'Microsoft', 'Edge', 'User Data'), 'browser', ''),
    r(w.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'), 'browser', ''),
    r(w.join(local, 'Vivaldi', 'User Data'), 'browser', ''),
    r(w.join(local, 'Chromium', 'User Data'), 'browser', ''),
    r(w.join(roaming, 'Opera Software'), 'browser', ''),
    r(w.join(local, 'Opera Software'), 'browser', ''),
    r(w.join(roaming, 'Mozilla', 'Firefox'), 'block', 'protect.browserProfile'),
    r(w.join(local, 'Mozilla', 'Firefox', 'Profiles'), 'browser', ''),
    // Personal folders (allowed only by explicit, manual selection)
    r(w.join(user, 'Documents'), 'personal', 'protect.personal'),
    r(w.join(user, 'Desktop'), 'personal', 'protect.personal'),
    r(w.join(user, 'Pictures'), 'personal', 'protect.personal'),
    r(w.join(user, 'Videos'), 'personal', 'protect.personal'),
    r(w.join(user, 'Music'), 'personal', 'protect.personal'),
    r(env.OneDrive, 'personal', 'protect.personal'),
    r(env.OneDriveConsumer, 'personal', 'protect.personal'),
    r(env.OneDriveCommercial, 'personal', 'protect.personal'),
    // Credentials / keys stored in the profile root
    r(w.join(user, '.ssh'), 'block', 'protect.credentials'),
    r(w.join(user, '.gnupg'), 'block', 'protect.credentials'),
  ];
  return rules.filter((x): x is ProtectionRule => !!x);
}

export function buildPosixRules(env: EnvLike): ProtectionRule[] {
  const home = env.HOME || '/root';
  const block = ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/proc', '/sbin', '/sys', '/usr', '/var/lib', '/snap', '/opt', '/run'];
  return [
    ...block.map((prefix) => ({ prefix, verdict: 'block' as const, reason: 'protect.system' })),
    { prefix: '/tmp', verdict: 'allow', reason: '' },
    { prefix: '/var/tmp', verdict: 'allow', reason: '' },
    ...['Documents', 'Desktop', 'Pictures', 'Videos', 'Music'].map((d) => ({
      prefix: nodePath.posix.join(home, d), verdict: 'personal' as const, reason: 'protect.personal',
    })),
    { prefix: nodePath.posix.join(home, '.ssh'), verdict: 'block', reason: 'protect.credentials' },
    { prefix: nodePath.posix.join(home, '.gnupg'), verdict: 'block', reason: 'protect.credentials' },
    { prefix: nodePath.posix.join(home, '.config', 'google-chrome'), verdict: 'browser', reason: '' },
    { prefix: nodePath.posix.join(home, '.mozilla'), verdict: 'block', reason: 'protect.browserProfile' },
  ];
}

export const BLOCKED_FILE_NAMES = [
  'ntuser.dat*', 'usrclass.dat*', 'ntuser.ini', 'ntuser.pol', 'bootmgr', 'bootnxt', 'pagefile.sys', 'hiberfil.sys',
  'swapfile.sys', 'desktop.ini', 'boot.ini', 'ntldr', 'login data', 'login data-journal', 'web data', 'cookies',
  'cookies-journal', 'logins.json', 'key4.db', 'key3.db', 'cert9.db', 'places.sqlite', 'cookies.sqlite',
  'formhistory.sqlite', 'local state', 'bookmarks',
];

export const BLOCKED_SEGMENTS = ['$recycle.bin', 'system volume information', '$windows.~bt', '$windows.~ws', 'windowsapps'];

export function buildProtectionConfig(opts: { windows: boolean; env: EnvLike; exclusions: string[]; extraRules?: ProtectionRule[] }): ProtectionConfig {
  return compileConfig({
    windows: opts.windows,
    rules: [...(opts.windows ? buildWindowsRules(opts.env) : buildPosixRules(opts.env)), ...(opts.extraRules ?? [])],
    exclusions: opts.exclusions,
    browserCacheDirs: BROWSER_CACHE_DIRS,
    blockedFileNames: BLOCKED_FILE_NAMES,
    blockedSegments: BLOCKED_SEGMENTS,
  });
}
