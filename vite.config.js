import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  server: { port: 5173 },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/agent-widget.js'),
      name: 'AIAgentWidget',
      fileName: (format) => (format === 'es' ? 'agent-widget.js' : 'agent-widget.iife.js'),
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
