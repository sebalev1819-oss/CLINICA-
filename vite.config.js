import { defineConfig } from 'vite';
import { resolve } from 'path';

// Vite build toma index.html como entry y procesa los <script type="module">
// Mantenemos RehabMed_ERP_1.html como nombre histórico (ya estaba en prod),
// index.html redirige a él en dev/preview.
export default defineConfig({
  server: { port: 5173, open: '/RehabMed_ERP_1.html' },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main:     resolve(__dirname, 'index.html'),
        rehabmed: resolve(__dirname, 'RehabMed_ERP_1.html'),
      },
    },
  },
});
