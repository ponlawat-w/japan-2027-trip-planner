import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // Relative asset paths, so the build works under GitHub Pages' /<repository>/ prefix without
  // naming the repository here. The app has no client-side routes for this to break.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@data': fileURLToPath(new URL('./data', import.meta.url)),
    },
  },
  build: {
    // OpenLayers alone is most of the bundle; splitting it would not make first paint faster.
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5190,
  },
});
