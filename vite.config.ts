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
      // Polyfill Buffer for GramJS
      buffer: 'buffer/',
    },
  },
  optimizeDeps: {
    // Ensure these packages are pre-bundled to avoid commonjs/esm issues
    include: ['telegram', 'buffer', 'big-integer', 'pako'],
    esbuildOptions: {
        define: {
            global: 'globalThis'
        }
    }
  }
})