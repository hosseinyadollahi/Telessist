import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    "global": "window",
    "process.env": {},
  },
  resolve: {
    alias: {
      // Basic Node Polyfills
      buffer: 'buffer/',
      util: 'util/',
      events: 'events',
      assert: 'assert',
      
      // Map Node modules to Browserify equivalents
      path: 'path-browserify',
      stream: 'stream-browserify',
      os: 'os-browserify',
      
      // Mock modules that don't exist in browser to empty objects
      fs: path.resolve(__dirname, 'src/lib/empty-polyfill.js'),
      net: path.resolve(__dirname, 'src/lib/empty-polyfill.js'),
      tls: path.resolve(__dirname, 'src/lib/empty-polyfill.js'),
      child_process: path.resolve(__dirname, 'src/lib/empty-polyfill.js'),
    },
  },
  optimizeDeps: {
    // Force Vite to bundle these, treating them as browser-compatible after aliasing
    include: [
        'telegram', 
        'buffer', 
        'util', 
        'events', 
        'stream-browserify',
        'path-browserify',
        'assert',
        'big-integer',
        'pako'
    ],
    esbuildOptions: {
        define: {
            global: 'globalThis'
        }
    }
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true, // Important for GramJS
    }
  }
})