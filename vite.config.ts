import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
    const base = mode === 'gh-pages' ? '/M-S-WM-CORP_4_App/' : '/';
    return {
      // GitHub Pages serves under /<repo>/ (unless you set a custom domain).
      // Build with: `vite build --mode gh-pages`
      base,
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      build: {
        chunkSizeWarningLimit: 2000,
      },
      plugins: [
        react(),
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-32.png'],
          manifest: {
            name: 'M&S Construcción',
            short_name: 'M&S',
            description: 'Sistema integral de gestión: Proyectos, Presupuestos, Seguimiento, Compras y RRHH.',
            start_url: base,
            scope: base,
            display: 'standalone',
            background_color: '#0A192F',
            theme_color: '#0A192F',
            icons: [
              {
                src: 'icon-192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any maskable',
              },
              {
                src: 'icon-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any maskable',
              },
            ],
          },
        }),
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
