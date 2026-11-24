import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: 'ui',
  base: './',
  plugins: [preact()],
  build: { outDir: '../dist/ui', emptyOutDir: true, target: 'chrome130', chunkSizeWarningLimit: 1500 },
  server: { port: 5318, strictPort: true },
});
