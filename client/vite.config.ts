import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type PluginOption } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const FONTS_SRC = fileURLToPath(
  new URL(
    '../node_modules/@excalidraw/excalidraw/dist/prod/fonts',
    import.meta.url,
  ),
);

/**
 * Self-host Excalidraw's canvas fonts so drawings work offline (no CDN);
 * paired with window.EXCALIDRAW_ASSET_PATH in index.html. Served straight
 * from node_modules in dev, copied into dist on build.
 */
function excalidrawFonts(): Plugin {
  return {
    name: 'excalidraw-fonts',
    configureServer(server) {
      server.middlewares.use('/excalidraw/fonts', (req, res, next) => {
        const rel = (req.url ?? '').split('?')[0] ?? '';
        const file = join(FONTS_SRC, rel);
        if (rel.includes('..') || !existsSync(file)) return next();
        res.setHeader('Content-Type', 'font/woff2');
        res.end(readFileSync(file));
      });
    },
    writeBundle() {
      cpSync(
        FONTS_SRC,
        fileURLToPath(new URL('./dist/excalidraw/fonts', import.meta.url)),
        { recursive: true },
      );
    },
  };
}

// cast: plugin types resolve against the hoisted root vite (7, via vitest)
// while the client runs vite 6 — all plugins support both at runtime
const plugins = [
  react(),
  tailwindcss(),
  excalidrawFonts(),
  // Offline app shell. The service worker deliberately never touches /api:
  // the IndexedDB layer in src/lib/offline owns offline data, GET
  // /api/pages/by-title/:title has a write side effect (ensurePage), and
  // replaying POST /api/ops belongs to the app-level op queue — a SW-level
  // retry (workbox-background-sync) would double-replay. Keep it that way.
  VitePWA({
    registerType: 'autoUpdate',
    injectRegister: false, // registered manually in src/lib/sw.ts
    manifest: false, // public/manifest.webmanifest is hand-maintained
    workbox: {
      // required for autoUpdate to actually apply: a new SW must activate
      // immediately and claim open clients, or it sits waiting forever and
      // tabs keep serving the previous build from precache
      skipWaiting: true,
      clientsClaim: true,
      globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
      // 13 MB of mostly-unused font variants; runtime-cached below instead
      globIgnores: ['excalidraw/**'],
      // largest chunk is ~1.8 MB; leave headroom over the 2 MiB default
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      cleanupOutdatedCaches: true,
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/api\//, /^\/ws/],
      runtimeCaching: [
        {
          urlPattern: /\/excalidraw\/fonts\/.*\.woff2$/,
          handler: 'CacheFirst',
          options: {
            cacheName: 'excalidraw-fonts',
            expiration: {
              maxEntries: 300,
              maxAgeSeconds: 365 * 24 * 60 * 60,
            },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
      ],
    },
  }),
] as unknown as PluginOption[];

export default defineConfig({
  plugins,
  // Excalidraw reads process.env at runtime; Vite has no process global
  define: {
    'process.env.IS_PREACT': JSON.stringify('false'),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
