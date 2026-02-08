import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Polyfill global for GramJS
    "global": "window",
    // Polyfill process for some node deps
    "process.env": {},
  },
  resolve: {
    alias: {
      // Polyfill Buffer and util for GramJS
      buffer: 'buffer/',
      util: 'util/',
    },
  },
  optimizeDeps: {
    // Ensure these packages are pre-bundled
    include: ['telegram', 'buffer', 'util', 'big-integer', 'pako'],
    esbuildOptions: {
        define: {
            global: 'globalThis'
        }
    }
  }
})