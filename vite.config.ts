import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [
    react(),
    {
      // Strict CSP for the packaged app; the dev server needs inline scripts and websockets for HMR.
      name: 'fristy-csp',
      transformIndexHtml(html, ctx) {
        const prod = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
        const dev = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:5183 http://localhost:5183; object-src 'none'";
        return html.replace('%CSP%', ctx.server ? dev : prod);
      },
    },
  ],
  resolve: { alias: { '@shared': path.resolve(__dirname, 'src/shared') } },
  server: { port: 5183, strictPort: true },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
