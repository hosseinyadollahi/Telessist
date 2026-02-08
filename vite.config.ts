import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Polyfill global for GramJS
    "global": "window",
  },
  resolve: {
    alias: {
      // Polyfill Buffer for GramJS
      buffer: 'buffer/',
    },
  },
})