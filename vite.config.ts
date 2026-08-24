import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  root: 'apps/client',
  base: mode === 'browser' ? './' : '/',
  build: { outDir: mode === 'browser' ? '../../dist/web' : '../../dist/client', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 4173,
    proxy: { '/api': 'http://127.0.0.1:4174' },
  },
}));
