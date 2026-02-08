import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // 'global': 'window', // Handled in index.html, removing to prevent conflicts
    'process.env': {}, // Polyfill for libraries accessing process.env
  },
  resolve: {
    alias: {
      // Basic Node Polyfills
      buffer: 'buffer/',
      util: 'util/',
      events: 'events',
      assert: 'assert',
      process: 'process/browser', 
      
      // Crypto Polyfill (Crucial for Telegram Auth)
      crypto: 'crypto-browserify',
      
      // Map Node modules to Browserify equivalents
      path: 'path-browserify',
      stream: 'stream-browserify',
      os: 'os-browserify',
      
      // Mock modules that don't exist in browser
      fs: path.resolve(__dirname, 'src/lib/empty-polyfill.js'),
      net: path.resolve(__dirname, 'src/lib/empty-polyfill.js'),
      tls: path.resolve(__dirname, 'src/lib/empty-polyfill.js'),
      child_process: path.resolve(__dirname, 'src/lib/empty-polyfill.js'),
    },
  },
  optimizeDeps: {
    include: [
        'telegram', 
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
    rollupOptions: {
        plugins: []
    }
  }
})