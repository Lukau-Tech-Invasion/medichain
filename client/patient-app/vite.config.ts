import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  // Served under /patient/ by the Docker nginx. See the note in the
  // doctor-portal vite config — base, router basename and the nginx location
  // must agree.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [
    react(),
    // Bundle treemap on demand: `ANALYZE=1 npm run build` -> dist/stats.html
    ...(process.env.ANALYZE
      ? [visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true })]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        // Standalone API on :8090 by default (8080 is the IPFS gateway's port —
        // see api/src/main.rs); set VITE_API_PROXY_TARGET to point at the Docker
        // Nginx gateway (http://127.0.0.1) instead.
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8090',
        changeOrigin: true,
        configure: (proxy) => {
          // /api/events is an SSE stream, so `res` here can be a raw socket
          // with no writeHead. Without this the dev server dies outright when
          // the API restarts under it, instead of failing the one request.
          proxy.on('error', (err, _req, res) => {
            console.log('Proxy error:', err.message);
            if (!res) return;
            if ('writeHead' in res) {
              if (!res.headersSent) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
              }
              res.end(JSON.stringify({ error: 'API server unavailable', details: err.message }));
              return;
            }
            if ('destroy' in res) res.destroy();
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
          state: ['zustand'],
          icons: ['lucide-react'],
          qr: ['qrcode'],
        },
      },
    },
  },
  // WASM support for crypto module
  optimizeDeps: {
    exclude: ['@medichain/wasm-crypto'],
  },
});
