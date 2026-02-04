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
      plugins: [
        react(),
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['icon.svg', 'manifest.webmanifest'],
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
                src: 'icon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
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
