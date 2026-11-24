import { describe, expect, it } from 'vitest';
import { buildProtectionConfig, classifyPath } from '../electron/protection';

const env = {
  SystemDrive: 'C:', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\dana', LOCALAPPDATA: 'C:\\Users\\dana\\AppData\\Local',
  APPDATA: 'C:\\Users\\dana\\AppData\\Roaming', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  ProgramData: 'C:\\ProgramData', OneDrive: 'C:\\Users\\dana\\OneDrive',
};
const cfg = buildProtectionConfig({ windows: true, env, exclusions: ['D:\\Keep'] });
const c = (p: string) => classifyPath(p, cfg);

describe('Windows protection rules', () => {
  it('blocks operating system locations', () => {
    expect(c('C:\\Windows\\System32\\kernel32.dll').blocked).toBe(true);
    expect(c('c:\\WINDOWS\\explorer.exe').blocked).toBe(true);
    expect(c('C:\\Windows\\WinSxS\\foo').blocked).toBe(true);
    expect(c('C:\\Boot\\BCD').blocked).toBe(true);
    expect(c('C:\\EFI\\Microsoft\\Boot\\bootmgfw.efi').blocked).toBe(true);
    expect(c('C:\\pagefile.sys').blocked).toBe(true);
    expect(c('D:\\hiberfil.sys').blocked).toBe(true);
    expect(c('C:\\').blocked).toBe(true);
    expect(c('E:\\System Volume Information\\x').blocked).toBe(true);
    expect(c('E:\\$Recycle.Bin\\S-1-5\\$R123.txt').blocked).toBe(true);
  });
  it('blocks registry hives and installed programs', () => {
    expect(c('C:\\Users\\dana\\NTUSER.DAT').blocked).toBe(true);
    expect(c('C:\\Users\\dana\\ntuser.dat.LOG1').blocked).toBe(true);
    expect(c('C:\\Users\\dana\\AppData\\Local\\Microsoft\\Windows\\UsrClass.dat').blocked).toBe(true);
    expect(c('C:\\Program Files\\App\\app.exe').blocked).toBe(true);
    expect(c('C:\\Program Files (x86)\\Steam\\userdata\\1\\save.dat').blocked).toBe(true);
  });
  it('allows known temp locations inside protected trees', () => {
    expect(c('C:\\Windows\\Temp\\setup.log').blocked).toBe(false);
    expect(c('C:\\Windows\\Minidump\\1.dmp').blocked).toBe(false);
    expect(c('C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportArchive\\a\\Report.wer').blocked).toBe(false);
    expect(c('C:\\ProgramData\\Microsoft\\Crypto\\key').blocked).toBe(true);
    expect(c('C:\\Users\\dana\\AppData\\Local\\Microsoft\\Windows\\INetCache\\IE\\x.dat').blocked).toBe(false);
    expect(c('C:\\Users\\dana\\AppData\\Local\\Microsoft\\Credentials\\x').blocked).toBe(true);
    expect(c('C:\\Users\\dana\\AppData\\Local\\Temp\\x.tmp').blocked).toBe(false);
  });
  it('only allows cache folders inside browser profiles', () => {
    const ud = 'C:\\Users\\dana\\AppData\\Local\\Google\\Chrome\\User Data';
    expect(c(`${ud}\\Default\\Cache\\Cache_Data\\f_000001`).blocked).toBe(false);
    expect(c(`${ud}\\Profile 1\\Code Cache\\js\\abc`).blocked).toBe(false);
    expect(c(`${ud}\\Default\\Login Data`).blocked).toBe(true);
    expect(c(`${ud}\\Default\\Network\\Cookies`).blocked).toBe(true);
    expect(c(`${ud}\\Default\\Sessions\\Session_1`).blocked).toBe(true);
    expect(c(`${ud}\\Default\\Local Storage\\leveldb\\000003.log`).blocked).toBe(true);
    expect(c(`${ud}\\Local State`).blocked).toBe(true);
    expect(c('C:\\Users\\dana\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\x.default\\logins.json').blocked).toBe(true);
    expect(c('C:\\Users\\dana\\AppData\\Local\\Mozilla\\Firefox\\Profiles\\x.default\\cache2\\entries\\A').blocked).toBe(false);
  });
  it('protects game saves and flags personal folders', () => {
    expect(c('C:\\Users\\dana\\Saved Games\\Game\\slot1.sav').blocked).toBe(true);
    expect(c('C:\\Users\\dana\\Documents\\My Games\\Skyrim\\Saves\\a.ess').blocked).toBe(true);
    expect(c('C:\\Users\\dana\\AppData\\LocalLow\\Studio\\Game\\save.json').blocked).toBe(true);
    const doc = c('C:\\Users\\dana\\Documents\\report.docx');
    expect(doc.blocked).toBe(false);
    expect(doc.personal).toBe(true);
    expect(c('C:\\Users\\dana\\OneDrive\\photo.jpg').personal).toBe(true);
    expect(c('C:\\Users\\dana\\Downloads\\setup.exe').personal).toBe(false);
  });
  it('honours user exclusions', () => {
    expect(c('D:\\Keep\\file.bin').blocked).toBe(true);
    expect(c('d:\\keep').blocked).toBe(true);
    expect(c('D:\\Keeper\\file.bin').blocked).toBe(false);
  });
});

import { parseCommandLine } from '../electron/system';

describe('uninstall command parsing', () => {
  it('handles quoted and unquoted executables', () => {
    expect(parseCommandLine('"C:\\Program Files\\App\\unins000.exe" /SILENT')).toEqual({ exe: 'C:\\Program Files\\App\\unins000.exe', args: '/SILENT' });
    expect(parseCommandLine('C:\\Program Files\\App 2\\uninstall.exe --remove')).toEqual({ exe: 'C:\\Program Files\\App 2\\uninstall.exe', args: '--remove' });
    expect(parseCommandLine('MsiExec.exe /X{1234}')).toEqual({ exe: 'MsiExec.exe', args: '/X{1234}' });
  });
});
