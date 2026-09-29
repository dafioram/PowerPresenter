import { defineConfig } from 'vite';

// Builds the standalone viewer (renderer + viewer, no editor) as one IIFE file.
// The app fetches it at export time and embeds it in standalone HTML (spec §15.5).
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'public/viewer',
    emptyOutDir: true,
    target: 'es2020',
    minify: true,
    lib: {
      entry: 'src/viewer/standalone.js',
      formats: ['iife'],
      name: 'PresViewer',
      fileName: () => 'viewer.js',
    },
  },
});
