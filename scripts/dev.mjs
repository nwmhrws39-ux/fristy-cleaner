// Development runner: starts Vite, bundles Electron sources, then launches Electron.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const url = 'http://localhost:5183';

await new Promise((res, rej) => {
  const b = spawn(process.execPath, ['scripts/build-electron.mjs'], { stdio: 'inherit' });
  b.on('exit', (c) => (c === 0 ? res() : rej(new Error('electron build failed'))));
});

const electronPath = (await import('electron')).default;
const app = spawn(electronPath, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
app.on('exit', async () => { await server.close(); process.exit(0); });
