import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    return {
      // GitHub Pages serves under /<repo>/ (unless you set a custom domain).
      // Build with: `vite build --mode gh-pages`
      base: mode === 'gh-pages' ? '/M-S-WM-CORP_4_App/' : '/',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
