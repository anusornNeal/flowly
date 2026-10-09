import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({
  root: 'apps/web',
  plugins: [react(), tailwind()],
  server: { host: '127.0.0.1', port: 5173, strictPort: false,
    proxy: { '/api': 'http://127.0.0.1:3210' } },
  build: { outDir: 'dist', emptyOutDir: true }
});
