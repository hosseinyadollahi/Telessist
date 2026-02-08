import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': {}, 
  },
  server: {
    proxy: {
      // Proxy Socket.io connection to Chat Service
      '/socket.io': {
        target: 'http://localhost:3002',
        ws: true,
        changeOrigin: true
      },
      // Proxy HTTP API requests to Chat Service
      '/api/chat': {
        target: 'http://localhost:3002',
        changeOrigin: true
      },
      // Proxy HTTP API requests to Auth Service (if needed)
      '/api/auth': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  resolve: {
    alias: {
      buffer: 'buffer/',
      util: 'util/',
      events: 'events',
      assert: 'assert',
      process: 'process/browser', 
      crypto: 'crypto-browserify',
      path: 'path-browserify',
      stream: 'stream-browserify',
      os: 'os-browserify',
      fs: path.resolve(__dirname, 'src/lib/empty-polyfill.js'),
      net: path.resolve(__dirname, 'src/lib/empty-polyfill.js'),
      tls: path.resolve(__dirname, 'src/lib/empty-polyfill.js'),
      child_process: path.resolve(__dirname, 'src/lib/empty-polyfill.js'),
    },
  },
  optimizeDeps: {
    include: [
        'buffer', 
        'util', 
        'events', 
        'stream-browserify',
        'path-browserify',
        'assert',
        'process',
        'crypto-browserify'
    ],
    esbuildOptions: {
        define: {
            global: 'globalThis'
        }
    }
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  }
})