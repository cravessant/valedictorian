import { defineConfig } from 'vite'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

export const mainExternals = ['@electric-sql/pglite', 'undici']

// https://vitejs.dev/config/
export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [
      ['**/*.test.tsx', 'jsdom'],
      ['src/app/loaders*.test.ts', 'jsdom'],
      ['src/theme/theme-applier.test.ts', 'jsdom'],
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**'],
    globalSetup: './src/test/global-setup.ts',
    maxWorkers: 2,
    minWorkers: process.env.CI ? 2 : undefined,
    setupFiles: './src/test/setup.ts',
    testTimeout: process.env.CI ? 30_000 : 5_000,
  },
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: mainExternals,
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
