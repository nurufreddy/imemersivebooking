import { defineConfig } from 'vite';

// Relative base so the production build works from any static host or sub-path
// (for example GitHub Pages at /<repo>/).
export default defineConfig({
  base: './',
  server: { host: true },
  preview: { host: true },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
  },
});
