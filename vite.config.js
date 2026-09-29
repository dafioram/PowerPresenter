import { defineConfig } from 'vite';
import { cspPlugin, serviceWorkerPlugin } from './scripts/vite-plugins.js';

// `base: './'` makes every URL relative, so the built site works from any
// GitHub Pages path (https://<user>.github.io/<repo>/) or any static host.
export default defineConfig({
  base: './',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 3000,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/prosemirror')) return 'prosemirror';
          if (id.includes('node_modules/preact') || id.includes('node_modules/immer') || id.includes('node_modules/fflate')) return 'vendor';
          return undefined;
        },
      },
    },
  },
  worker: { format: 'es' },
  plugins: [cspPlugin(), serviceWorkerPlugin()],
  test: {
    include: ['tests/unit/**/*.test.{js,jsx}'],
    environment: 'node',
    testTimeout: 20000,
  },
});
