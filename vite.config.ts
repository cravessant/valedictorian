import { defineConfig } from 'vite'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import { DurationBalancedSequencer } from './src/test/duration-balanced-sequencer'

export const mainExternals = ['@electric-sql/pglite', 'undici']
export const maintainedTestIncludes = [
  'electron/**/*.test.{ts,tsx}',
  'scripts/**/*.test.{ts,mjs}',
  'src/**/*.test.{ts,tsx}',
]

// https://vitejs.dev/config/
export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [
      ['**/*.test.tsx', 'jsdom'],
      ['src/app/loaders*.test.ts', 'jsdom'],
      ['src/theme/theme-applier.test.ts', 'jsdom'],
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.local/**', '**/.worktrees/**'],
    include: maintainedTestIncludes,
    globalSetup: './src/test/global-setup.ts',
    maxWorkers: 2,
    minWorkers: process.env.CI ? 2 : 1,
    pool: 'threads',
    sequence: {
      sequencer: DurationBalancedSequencer,
    },
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
