import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  server: { proxy: { '/api': 'http://127.0.0.1:4317', '/ws': { target: 'ws://127.0.0.1:4317', ws: true } } },
});
