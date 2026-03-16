import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
  },
  // Enable WASM support
  optimizeDeps: {
    exclude: ['@medichain/wasm-crypto'],
  },
  // Clear cache on changes
  cacheDir: 'node_modules/.vite',
});
