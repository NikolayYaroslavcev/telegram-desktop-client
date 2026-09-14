import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'src/renderer'),
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'out/renderer'),
    emptyOutDir: true,
  },
})
