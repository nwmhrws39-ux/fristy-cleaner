/** Windows integration: drives, PowerShell helpers, administrator detection, Recycle Bin, installed apps. */
import { execFile, spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DriveInfo, InstalledApp, RecycleBinInfo } from '../src/shared/types';

export const isWindows = process.platform === 'win32';

/** Runs a PowerShell script and returns stdout. */
export function runPowerShell(script: string, timeoutMs = 30_000): Promise<string> {
  const full = `$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;${script}`;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => (err ? reject(new Error(stderr?.trim() || err.message)) : resolve(stdout)),
    );
  });
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/* ---------------- Administrator ---------------- */

let adminCache: boolean | null = null;
export async function isAdmin(): Promise<boolean> {
  if (adminCache != null) return adminCache;
  if (!isWindows) return (adminCache = process.getuid?.() === 0);
  adminCache = await new Promise<boolean>((resolve) => {
    execFile('net', ['session'], { windowsHide: true }, (err) => resolve(!err));
  });
  return adminCache;
}

/** Relaunches the app elevated (UAC prompt). Resolves false if the user declined. */
export async function relaunchElevated(exe: string, args: string[]): Promise<boolean> {
  if (!isWindows) return false;
  const argList = args.length ? ` -ArgumentList ${psQuote(args.map((a) => `"${a}"`).join(' '))}` : '';
  try {
    await runPowerShell(`Start-Process -FilePath ${psQuote(exe)}${argList} -Verb RunAs`);
    return true;
  } catch {
    return false;
  }
}

/* ---------------- Drives ---------------- */

let labelCache: { at: number; map: Map<string, { label: string; fs: string; type: string }> } | null = null;

async function driveLabels() {
  if (labelCache && Date.now() - labelCache.at < 60_000) return labelCache.map;
  const map = new Map<string, { label: string; fs: string; type: string }>();
  try {
    const out = await runPowerShell(
      'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,FileSystem,DriveType | ConvertTo-Json -Compress',
      15_000,
    );
    const parsed = JSON.parse(out || '[]');
    const types: Record<number, string> = { 2: 'removable', 3: 'fixed', 4: 'network', 5: 'optical', 6: 'ram' };
    for (const d of Array.isArray(parsed) ? parsed : [parsed]) {
      map.set(String(d.DeviceID).toUpperCase(), { label: d.VolumeName || '', fs: d.FileSystem || '', type: types[d.DriveType] || 'unknown' });
    }
  } catch {
    /* labels are optional */
  }
  labelCache = { at: Date.now(), map };
  return map;
}

export async function listDrives(): Promise<DriveInfo[]> {
  if (!isWindows) {
    const st = await fsp.statfs('/');
    const total = st.blocks * st.bsize;
    const free = st.bavail * st.bsize;
    return [{ root: '/', label: 'System', fileSystem: '', type: 'fixed', total, free, used: total - free }];
  }
  const labels = await driveLabels();
  const out: DriveInfo[] = [];
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    const root = `${letter}:\\`;
    const meta = labels.get(`${letter}:`);
    if (labels.size && !meta) continue;
    try {
      const st = await fsp.statfs(root);
      const total = st.blocks * st.bsize;
      if (!total) continue;
      const free = st.bavail * st.bsize;
      out.push({ root, label: meta?.label || '', fileSystem: meta?.fs || '', type: meta?.type || 'fixed', total, free, used: total - free });
    } catch {
      /* not ready / no media */
    }
  }
  return out;
}

/* ---------------- Recycle Bin ---------------- */

export async function recycleBinInfo(): Promise<RecycleBinInfo> {
  if (!isWindows) return { supported: false, count: 0, bytes: 0 };
  try {
    const out = await runPowerShell(
      "$sh=New-Object -ComObject Shell.Application;$rb=$sh.Namespace(10);$n=0;[int64]$t=0;" +
        "foreach($i in $rb.Items()){$n++;$s=$i.ExtendedProperty('System.Size');if($s){$t+=[int64]$s}};" +
        '@{count=$n;bytes=$t}|ConvertTo-Json -Compress',
      60_000,
    );
    const r = JSON.parse(out);
    return { supported: true, count: Number(r.count) || 0, bytes: Number(r.bytes) || 0 };
  } catch {
    return { supported: false, count: 0, bytes: 0 };
  }
}

/** Permanently empties the Recycle Bin. Only called after an explicit typed confirmation. */
export async function emptyRecycleBin(): Promise<void> {
  if (!isWindows) throw new Error('Not supported on this platform');
  await runPowerShell('Clear-RecycleBin -Force -ErrorAction Stop', 120_000);
}

export function openRecycleBin() {
  if (!isWindows) return;
  spawn('explorer.exe', ['shell:RecycleBinFolder'], { detached: true, stdio: 'ignore' }).unref();
}

/* ---------------- Installed applications ---------------- */

interface RawApp {
  DisplayName?: string;
  Publisher?: string;
  DisplayVersion?: string;
  InstallDate?: string;
  EstimatedSize?: number;
  InstallLocation?: string;
  UninstallString?: string;
  WindowsInstaller?: number;
  PSChildName?: string;
  PSPath?: string;
}

const uninstallCommands = new Map<string, { cmd: string; msiGuid: string | null; name: string }>();

function parseInstallDate(s?: string): number | null {
  if (!s || !/^\d{8}$/.test(s)) return null;
  const d = new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  return isNaN(d.getTime()) ? null : d.getTime();
}

export async function listInstalledApps(): Promise<InstalledApp[]> {
  if (!isWindows) return [];
  const script =
    "$p='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*';" +
    "Get-ItemProperty $p -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and $_.SystemComponent -ne 1 -and -not $_.ParentKeyName -and $_.ReleaseType -notin @('Update','Hotfix','Security Update') } | " +
    'Select-Object DisplayName,Publisher,DisplayVersion,InstallDate,EstimatedSize,InstallLocation,UninstallString,WindowsInstaller,PSChildName,PSPath | ConvertTo-Json -Compress -Depth 2';
  const out = await runPowerShell(script, 60_000);
  const parsed: RawApp | RawApp[] = JSON.parse(out || '[]');
  const list = Array.isArray(parsed) ? parsed : [parsed];
  uninstallCommands.clear();
  const seen = new Set<string>();
  const apps: InstalledApp[] = [];
  for (const a of list) {
    if (!a?.DisplayName) continue;
    const dedupeKey = `${a.DisplayName}|${a.DisplayVersion ?? ''}`.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const id = crypto.createHash('sha1').update(String(a.PSPath ?? a.DisplayName)).digest('hex').slice(0, 16);
    const msiGuid = a.WindowsInstaller === 1 && /^\{[0-9A-F-]{36}\}$/i.test(a.PSChildName ?? '') ? a.PSChildName! : null;
    if (a.UninstallString || msiGuid) uninstallCommands.set(id, { cmd: a.UninstallString ?? '', msiGuid, name: a.DisplayName });
    apps.push({
      id,
      name: a.DisplayName.trim(),
      publisher: (a.Publisher ?? '').trim(),
      version: (a.DisplayVersion ?? '').trim(),
      installDate: parseInstallDate(a.InstallDate),
      sizeBytes: typeof a.EstimatedSize === 'number' && a.EstimatedSize > 0 ? a.EstimatedSize * 1024 : null,
      location: (a.InstallLocation ?? '').trim().replace(/^"|"$/g, ''),
      hasUninstaller: !!(a.UninstallString || msiGuid),
      scope: String(a.PSPath ?? '').includes('HKEY_CURRENT_USER') ? 'user' : 'machine',
    });
  }
  return apps.sort((x, y) => x.name.localeCompare(y.name));
}

/** Splits an UninstallString into executable + arguments. */
export function parseCommandLine(s: string): { exe: string; args: string } {
  const t = s.trim();
  if (t.startsWith('"')) {
    const end = t.indexOf('"', 1);
    if (end > 0) return { exe: t.slice(1, end), args: t.slice(end + 1).trim() };
  }
  const m = t.match(/^(.*?\.exe)(\s+.*)?$/i);
  if (m) return { exe: m[1], args: (m[2] ?? '').trim() };
  return { exe: t, args: '' };
}

/**
 * Launches the application's own (official) uninstaller via ShellExecute so Windows shows the
 * UAC prompt when needed. Application folders are never deleted manually.
 */
export async function launchUninstaller(id: string): Promise<void> {
  const entry = uninstallCommands.get(id);
  if (!entry) throw new Error('Uninstaller not found. Refresh the list and try again.');
  let exe: string;
  let args: string;
  if (entry.cmd) {
    // The application's registered UninstallString is the official uninstall interface.
    ({ exe, args } = parseCommandLine(entry.cmd));
  } else {
    exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'msiexec.exe');
    args = `/x ${entry.msiGuid}`;
  }
  await runPowerShell(`Start-Process -FilePath ${psQuote(exe)}${args ? ` -ArgumentList ${psQuote(args)}` : ''}`);
}
