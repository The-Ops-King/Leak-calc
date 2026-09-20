import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    // One page, one chunk. Splitting would cost a round trip on mobile data.
    rollupOptions: { output: { manualChunks: undefined } },
  },
  server: { port: 5173 },
})
