import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: '/piflea-market/',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 4096,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
