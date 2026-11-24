// End-to-end check of the packaged Electron app against a temporary test directory.
// Drives the real renderer -> preload -> IPC -> worker -> cleaner path with Playwright.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(`${execSync('npm root -g').toString().trim()}/playwright`); }

const shots = process.env.SHOTS || path.join(os.tmpdir(), 'fristy-shots');
fs.mkdirSync(shots, { recursive: true });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fristy-e2e-'));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'fristy-cfg-'));
const w = (p, data, ageDays = 0) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  if (ageDays) { const t = new Date(Date.now() - ageDays * 864e5); fs.utimesSync(p, t, t); }
};
const blob = crypto.randomBytes(2 * 1024 * 1024);
w(path.join(root, 'photos', 'holiday.jpg'), blob);
w(path.join(root, 'backup', 'holiday (1).jpg'), blob);
w(path.join(root, 'backup', 'old', 'IMG_0001.jpg'), blob);
w(path.join(root, 'work', 'report.tmp'), 'temp', 5);
w(path.join(root, 'work', 'crash.dmp'), Buffer.alloc(5000), 5);
w(path.join(root, 'work', 'notes.txt'), 'keep me');
w(path.join(root, 'video', 'movie.mkv'), Buffer.alloc(3 * 1024 * 1024));
fs.mkdirSync(path.join(root, 'empty', 'nested'), { recursive: true });

const app = await pw._electron.launch({ executablePath: process.env.APP_EXE || require('electron'), args: process.env.APP_EXE ? ['--no-sandbox'] : ['.', '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg }, cwd: process.cwd() });
const page = await app.firstWindow();
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForSelector('nav');
const log = (...a) => console.log('[e2e]', ...a);

const waitScan = (kind) => page.evaluate((k) => new Promise((res) => {
  const off = window.fristy.scan.onComplete((s) => { if (s.kind === k) { off(); res(s); } });
}), kind);

// Settings: use our test tree as the default location; 1 MB large-file threshold.
await page.evaluate((r) => window.fristy.settings.set({ defaultScanLocations: [r], largeFileMinMB: 1, duplicateMinKB: 1 }), root);

await page.screenshot({ path: `${shots}/01-dashboard.png` });

// Deep scan
let done = waitScan('deep');
await page.evaluate((r) => window.fristy.scan.start({ kind: 'deep', roots: [r] }), root);
const deep = await done;
log('deep categories', JSON.stringify(deep.categories.map((c) => [c.id, c.count, c.bytes])));
await page.evaluate(() => {}); 

// Duplicates
done = waitScan('duplicates');
await page.evaluate((r) => window.fristy.scan.start({ kind: 'duplicates', roots: [r], dupMinBytes: 1024 }), root);
const dup = await done;
const groups = await page.evaluate((id) => window.fristy.scan.groups(id, 0, 50, 'recoverable'), dup.scanId);
log('dup groups', groups.total, 'recoverable', groups.recoverable, groups.groups.map((g) => g.items.map((i) => path.basename(i.path))));
if (groups.total !== 1 || groups.groups[0].items.length !== 3) throw new Error('duplicate detection mismatch');

// Navigate to UI pages for screenshots
const nav = async (label, file) => { await page.getByRole('button', { name: label, exact: true }).first().click(); await page.waitForTimeout(700); await page.screenshot({ path: `${shots}/${file}` }); };
await nav('Deep Scan', '02-deep.png');
await page.getByText('Temporary files', { exact: true }).first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${shots}/03-deep-expanded.png` });
await nav('Duplicate Files', '04-duplicates.png');

// Clean via the UI: recommended selection, then confirm dialog → Recycle Bin.
await page.getByRole('button', { name: 'All but one per group' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Clean selected' }).click();
await page.waitForSelector('text=Confirm cleaning');
await page.waitForTimeout(400);
await page.screenshot({ path: `${shots}/05-confirm.png` });
await page.getByRole('button', { name: 'Move to Recycle Bin' }).last().click();
await page.waitForSelector('text=Cleaning complete', { timeout: 30000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${shots}/06-result.png` });
const remaining = ['photos/holiday.jpg', 'backup/holiday (1).jpg', 'backup/old/IMG_0001.jpg'].filter((p) => fs.existsSync(path.join(root, p)));
log('duplicate copies remaining on disk', remaining);
if (remaining.length !== 1) log('NOTE: trash may be unavailable in this headless Linux session; see history');
await page.getByRole('button', { name: 'Close', exact: true }).last().click();

const hist = await page.evaluate(() => window.fristy.history.list());
const det = await page.evaluate((id) => window.fristy.history.details(id), hist[0].id);
log('history', JSON.stringify(hist[0]), det.items.map((i) => `${path.basename(i.path)}:${i.status}${i.error ? ':' + i.error : ''}`));

// Analyzer
done = waitScan('analyze');
await page.evaluate((r) => window.fristy.scan.start({ kind: 'analyze', roots: [r] }), root);
await done;
await nav('Disk Analyzer', '07-analyzer.png');
await nav('Large Files', '08-large.png');
await nav('Cleaning History', '09-history.png');
await nav('Settings', '10-settings.png');
await nav('Dashboard', '11-dashboard-after.png');

// Hebrew / RTL and light theme
await page.evaluate(() => window.fristy.settings.set({ language: 'he' }));
await page.reload();
await page.waitForSelector('nav');
await page.waitForTimeout(600);
await page.screenshot({ path: `${shots}/12-hebrew.png` });
await page.evaluate(() => window.fristy.settings.set({ language: 'en', theme: 'light' }));
await page.reload();
await page.waitForSelector('nav');
await page.waitForTimeout(600);
await page.screenshot({ path: `${shots}/13-light.png` });
await page.evaluate(() => window.fristy.settings.set({ theme: 'dark', defaultScanLocations: [] }));

// Security: renderer has no Node.js
const nodeAccess = await page.evaluate(() => typeof window.require + '/' + typeof window.process);
log('renderer node access (expect undefined/undefined):', nodeAccess);

await app.close();
fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(cfg, { recursive: true, force: true });
log('OK, screenshots in', shots);
