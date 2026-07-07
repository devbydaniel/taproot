import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type PluginOption } from 'vite';

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
