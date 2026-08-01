import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Builds the React admin SPA into ./dist/client, which the Worker serves
// through the ASSETS binding (single-page-application handling).
export default defineConfig({
  root: resolve(__dirname, 'src/frontend'),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/frontend/index.html'),
    },
  },
  server: {
    proxy: {
      // Local dev: proxy API calls to `wrangler dev`.
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
