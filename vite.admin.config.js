import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/agent-admin.js'),
      name: 'AIAgentAdmin',
      fileName: (format) => (format === 'es' ? 'agent-admin.js' : 'agent-admin.iife.js'),
      formats: ['es', 'iife'],
    },
    outDir: 'dist',
    rollupOptions: {
      output: {
        exports: 'named',
        inlineDynamicImports: true,
      },
    },
  },
});
