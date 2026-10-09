import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Builds the two dependency-free embeddables into dist/embed/:
//   ask-widget.js     <div data-plumbline-ask></div>
//   status-badge.js   <div data-plumbline-status></div>
export default defineConfig({
  build: {
    outDir: 'dist/embed',
    emptyOutDir: true,
    target: 'es2019',
    lib: {
      entry: { 'ask-widget': resolve(__dirname, 'src/embed/askWidget.ts'), 'status-badge': resolve(__dirname, 'src/embed/statusBadge.ts') },
      formats: ['es'],
      fileName: (_fmt, name) => `${name}.js`,
    },
  },
});
