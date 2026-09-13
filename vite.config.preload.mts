import path from 'node:path'
import { defineConfig } from 'vite'

/**
 * A sandboxed preload script (sandbox: true) runs under Electron's
 * restricted preload module loader, which only resolves a small built-in
 * whitelist (electron, events, timers, url) - it cannot `require()` other
 * local project files. tsc's per-file CommonJS output for src/preload
 * emits exactly such a cross-file require (for the shared IPC channel
 * constant), which fails at runtime with "module not found". Bundling the
 * preload into a single self-contained file avoids that entirely, and
 * scales once Task 06 grows the shared IPC contract.
 */
export default defineConfig({
  build: {
    outDir: path.resolve(import.meta.dirname, 'out/preload'),
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/preload/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
})
