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
        target: 'http://127.0.0.1:8080',
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
            console.log('Proxying:', req.method, req.url, '-> http://127.0.0.1:8080');
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
