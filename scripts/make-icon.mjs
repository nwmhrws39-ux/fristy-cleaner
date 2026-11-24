// Renders build/icon.svg to build/icon.png (512px) and build/icon.ico (16-256px, PNG-compressed
// entries) using Playwright's Chromium. Run once with `npm run icons`; the outputs are committed.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require(`${execSync('npm root -g').toString().trim()}/playwright`);
}

const svg = fs.readFileSync('build/icon.svg', 'utf8');
const browser = await playwright.chromium.launch();
async function render(size) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`);
  const buf = await page.locator('svg').screenshot({ omitBackground: true });
  await page.close();
  return buf;
}

fs.writeFileSync('build/icon.png', await render(512));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = [];
for (const s of sizes) images.push(await render(s));
await browser.close();

// ICO container: header + directory entries + PNG payloads.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
const dir = Buffer.alloc(16 * sizes.length);
let offset = 6 + dir.length;
sizes.forEach((s, i) => {
  const e = i * 16;
  dir.writeUInt8(s >= 256 ? 0 : s, e);
  dir.writeUInt8(s >= 256 ? 0 : s, e + 1);
  dir.writeUInt8(0, e + 2);
  dir.writeUInt8(0, e + 3);
  dir.writeUInt16LE(1, e + 4);
  dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(images[i].length, e + 8);
  dir.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
fs.writeFileSync('build/icon.ico', Buffer.concat([header, dir, ...images]));
console.log('build/icon.png and build/icon.ico written');
