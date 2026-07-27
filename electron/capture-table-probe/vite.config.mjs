// .mjs so it stays out of the app's tsc project; relative base so the bundle loads over file://.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: here,
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(here, '../../src'),
    },
  },
  build: {
    outDir: path.resolve(here, 'dist'),
    emptyOutDir: true,
    minify: false,
  },
})
