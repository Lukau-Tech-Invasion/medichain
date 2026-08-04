import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
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
      '@medichain/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5173,
    host: true, // Listen on all interfaces
    strictPort: true, // Fail if port is in use
    // HMR configuration for WebSocket
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 5173,
      clientPort: 5173,
    },
    proxy: {
      '/api': {
        // Where the dev server forwards /api/* to. Configurable so both
        // deployment shapes work:
        //   - Standalone API (the README quickstart, no Docker): the API binds
        //     127.0.0.1:8090 directly — this is the default here. (8090, not
        //     8080: 8080 is the IPFS gateway's port, see api/src/main.rs.)
        //   - Full Docker stack: the API sits behind the Nginx gateway on :80;
        //     set VITE_API_PROXY_TARGET=http://127.0.0.1 to point there.
        // Previously this hardcoded :80, so the documented no-Docker quickstart
        // could not reach the API at all — every frontend call 503'd.
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8090',
        changeOrigin: true,
        secure: false,
        // Add timeout and error handling
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.log('Proxy error:', err);
            if (res && 'writeHead' in res) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'API server unavailable', details: err.message }));
            }
          });
          proxy.on('proxyReq', (_proxyReq, req) => {
              console.log('Proxying:', req.method, req.url, '-> http://127.0.0.1');
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
        // Split long-lived vendor code out of the per-route lazy chunks so the
        // initial payload stays small and vendors cache across deploys.
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
          state: ['zustand'],
          icons: ['lucide-react'],
          date: ['date-fns'],
        },
      },
    },
  },
  // Enable WASM support
  optimizeDeps: {
    exclude: ['@medichain/wasm-crypto'],
  },
  // Clear cache on changes
  cacheDir: 'node_modules/.vite',
});
