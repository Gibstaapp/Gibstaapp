import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// VITE_STATIC=1 builds the GitHub Pages site, served from /Gibstaapp/ (override with VITE_BASE).
const base = process.env.VITE_STATIC === '1' ? (process.env.VITE_BASE ?? '/Gibstaapp/') : '/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': 'http://localhost:8787', '/download': 'http://localhost:8787' } },
});
