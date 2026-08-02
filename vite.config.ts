import { defineConfig } from 'vite'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import { DurationBalancedSequencer } from './src/test/duration-balanced-sequencer'
import { rendererManualChunk } from './scripts/renderer-chunk-policy'

export const mainExternals = ['@electric-sql/pglite', 'undici']
export const maintainedTestIncludes = [
  'electron/**/*.test.{ts,tsx}',
  'packages/connector-api/**/*.test.{ts,tsx}',
  'packages/connector-testkit/**/*.test.{ts,tsx}',
  'scripts/**/*.test.{ts,mjs}',
  'src/**/*.test.{ts,tsx}',
]
// The jsdom set is subtracted from the node project's discovery, so every maintained
// test is owned by exactly one project and neither list may drift on its own.
export const jsdomTestIncludes = [
  'electron/**/*.test.tsx',
  'src/**/*.test.tsx',
  'src/app/loaders*.test.ts',
  'src/theme/theme-applier.test.ts',
]
export const maintainedTestExcludes = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.local/**',
  '**/.worktrees/**',
]

// https://vitejs.dev/config/
export default defineConfig({
  // Renderer-only: vite-plugin-electron builds main and preload with their own
  // configs, so this leaves dist-electron output untouched.
  build: {
    rollupOptions: {
      output: {
        manualChunks: rendererManualChunk,
      },
    },
  },
  test: {
    globalSetup: './src/test/global-setup.ts',
    maxWorkers: 2,
    minWorkers: process.env.CI ? 2 : 1,
    pool: 'threads',
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          exclude: [...maintainedTestExcludes, ...jsdomTestIncludes],
          include: maintainedTestIncludes,
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          exclude: maintainedTestExcludes,
          include: jsdomTestIncludes,
        },
      },
    ],
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
