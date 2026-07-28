import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ADVERSARY_PLUGIN_NAME } from './renderer-graph-adversary.config'
import {
  ELECTRON_RENDERER_PLUGIN_NAME,
  RENDERER_CONFIG_FILE,
  buildGraphChunks,
  buildRendererChunks,
  chunkImportCycles,
  duplicatedModuleOwnership,
  loadGraphConfig,
  loadRendererGraphConfig,
  withProductionNodeEnv,
  type RendererChunk,
  type RendererGraphConfig,
} from './renderer-chunk-graph'
import {
  RENDERER_CHUNK_DOMAINS,
  RENDERER_CHUNK_SIZE_BUDGET_KB,
  RENDERER_RESIDUAL_CHUNK,
  packageNameOfModule,
  rendererChunkForPackage,
  rendererChunkSizeKb,
  rendererManualChunk,
} from './renderer-chunk-policy'

const buildTimeoutMs = 120_000

const adversaryConfigFile = fileURLToPath(
  new URL('./renderer-graph-adversary.config.ts', import.meta.url),
)

let pendingChunks: Promise<RendererChunk[]> | null = null
let pendingConfig: Promise<RendererGraphConfig> | null = null

/** One shared in-memory build for every graph assertion in this file. */
function builtChunks(): Promise<RendererChunk[]> {
  pendingChunks ??= buildRendererChunks()
  return pendingChunks
}

/** The checked-in config as production evaluates it, never as the runner imports it. */
function productionConfig(): Promise<RendererGraphConfig> {
  pendingConfig ??= loadRendererGraphConfig()
  return pendingConfig
}

describe('renderer chunk policy', () => {
  it('keeps Vite\'s default large-chunk threshold as the budget', async () => {
    expect((await productionConfig()).config.build?.chunkSizeWarningLimit).toBeUndefined()
    expect(RENDERER_CHUNK_SIZE_BUDGET_KB).toBe(500)
  })

  it('wires the semantic classifier into the renderer build', async () => {
    const output = (await productionConfig()).config.build?.rollupOptions?.output
    expect(Array.isArray(output)).toBe(false)
    const manualChunks = (output as { manualChunks?: unknown } | undefined)?.manualChunks
    expect(typeof manualChunks).toBe('function')

    // The config is evaluated in its own module graph, so the wired classifier cannot be
    // compared by identity; pin the classification that makes it the same classifier.
    const classify = manualChunks as (id: string) => string | undefined
    const probes = [
      '/repo/src/App.tsx',
      '/repo/node_modules/.pnpm/react-dom@18/node_modules/react-dom/client.js',
      '/repo/node_modules/@radix-ui/react-dialog/dist/index.js',
      '/repo/node_modules/@tanstack/react-query/build/index.js',
      '/repo/node_modules/@sparxie/sdk/dist/index.js',
      '/repo/node_modules/a-package-nobody-claimed/index.js',
    ]
    expect(probes.map(classify)).toEqual(probes.map(rendererManualChunk))
    expect(probes.map(classify)).toEqual([
      undefined,
      'vendor-react',
      'vendor-ui',
      'vendor-data',
      'vendor-connectors',
      RENDERER_RESIDUAL_CHUNK,
    ])
  })

  it('classifies dependencies by package domain and leaves app source in the entry', () => {
    expect(rendererManualChunk('/repo/src/App.tsx')).toBeUndefined()
    expect(rendererManualChunk('/repo/node_modules/.pnpm/react-dom@18/node_modules/react-dom/client.js'))
      .toBe('vendor-react')
    expect(rendererChunkForPackage('@radix-ui/react-dialog')).toBe('vendor-ui')
    expect(rendererChunkForPackage('@tanstack/react-query')).toBe('vendor-data')
    expect(rendererChunkForPackage('@sparxie/sdk')).toBe('vendor-connectors')
    expect(rendererChunkForPackage('a-package-nobody-claimed')).toBe(RENDERER_RESIDUAL_CHUNK)
  })

  it('resolves package names through the pnpm virtual store', () => {
    expect(packageNameOfModule('/repo/node_modules/.pnpm/zod@4/node_modules/zod/index.js')).toBe('zod')
    expect(packageNameOfModule('/repo/node_modules/@tanstack/query-core/build/index.js'))
      .toBe('@tanstack/query-core')
    expect(packageNameOfModule('/repo/src/main.tsx')).toBeNull()
  })

  it('owns each package by exactly one domain', () => {
    const claims = RENDERER_CHUNK_DOMAINS.flatMap((domain) => [...domain.packages, ...domain.scopes ?? []])
    expect(claims.length).toBe(new Set(claims).size)
  })

  it('routes an unclaimed scope to the residual chunk rather than the nearest domain', () => {
    expect(rendererChunkForPackage('@unclaimed/thing')).toBe(RENDERER_RESIDUAL_CHUNK)
  })
})

/**
 * The budget is a byte budget. Vite's reporter sizes chunks with `Buffer.byteLength`, so a
 * character count silently discounts every multi-byte character in the emitted asset.
 */
describe('chunk size measurement', () => {
  it('measures UTF-8 bytes rather than UTF-16 characters', () => {
    const astral = '\u{1F600}'.repeat(1_000)
    expect(astral.length).toBe(2_000)
    expect(rendererChunkSizeKb(astral)).toBe(4)

    const accented = 'é'.repeat(1_000)
    expect(accented.length).toBe(1_000)
    expect(rendererChunkSizeKb(accented)).toBe(2)

    expect(rendererChunkSizeKb('a'.repeat(1_000))).toBe(1)
  })

  it('rejects a chunk that only fits the budget by character count', () => {
    // The shape a validator smuggled past the previous measure: 496.932 kB of characters
    // that weigh 576.932 kB once emitted, which is what Vite warns about.
    const smuggled = 'a'.repeat(416_932) + '\u{1F600}'.repeat(40_000)

    expect(smuggled.length / 1000).toBeLessThan(RENDERER_CHUNK_SIZE_BUDGET_KB)
    expect(rendererChunkSizeKb(smuggled)).toBeCloseTo(576.932, 3)
    expect(rendererChunkSizeKb(smuggled)).toBeGreaterThan(RENDERER_CHUNK_SIZE_BUDGET_KB)
  })
})

/** Detectors must be able to fail, or the built-graph assertions below prove nothing. */
describe('graph detectors', () => {
  const chunk = (fileName: string, imports: string[], moduleIds: string[]): RendererChunk =>
    ({ fileName, imports, moduleIds, name: fileName, sizeKb: 0 })

  it('reports a cycle between chunks and stays quiet on an acyclic graph', () => {
    expect(chunkImportCycles([chunk('a', ['b'], []), chunk('b', ['a'], [])]))
      .toEqual([['a', 'b', 'a']])
    expect(chunkImportCycles([chunk('a', ['b', 'c'], []), chunk('b', ['c'], []), chunk('c', [], [])]))
      .toEqual([])
  })

  it('reports a module claimed by two chunks and stays quiet otherwise', () => {
    expect(duplicatedModuleOwnership([chunk('a', [], ['m']), chunk('b', [], ['m', 'n'])]))
      .toEqual(['m'])
    expect(duplicatedModuleOwnership([chunk('a', [], ['m']), chunk('b', [], ['n'])])).toEqual([])
  })
})

/**
 * The graph is only the production graph if the config is evaluated fresh under a
 * production environment. This repository's config decides at evaluation time whether to
 * register the renderer plugin, so a config imported by the runner is a different config.
 */
describe('production config evaluation', () => {
  it('loads the config with the production Electron renderer plugin', async () => {
    expect((await productionConfig()).pluginNames).toContain(ELECTRON_RENDERER_PLUGIN_NAME)
  })

  it('drops only the Electron side builders', async () => {
    const { pluginNames } = await productionConfig()
    expect(pluginNames).not.toContain('vite-plugin-electron')
    expect(pluginNames).toContain('vite:react-babel')
    expect(pluginNames).toContain('@tailwindcss/vite:scan')
  })

  it('proves the runner\'s own environment yields a config without that plugin', async () => {
    expect(process.env.NODE_ENV).toBe('test')
    expect((await loadGraphConfig(RENDERER_CONFIG_FILE)).pluginNames)
      .not.toContain(ELECTRON_RENDERER_PLUGIN_NAME)
  })

  it('catches a production-only plugin that smuggles bytes past a character count', async () => {
    expect((await loadGraphConfig(adversaryConfigFile)).pluginNames)
      .not.toContain(ADVERSARY_PLUGIN_NAME)
    const loaded = await withProductionNodeEnv(() => loadGraphConfig(adversaryConfigFile))
    expect(loaded.pluginNames).toContain(ADVERSARY_PLUGIN_NAME)

    const chunks = await withProductionNodeEnv(() => buildGraphChunks(adversaryConfigFile))
    const oversized = chunks.filter((chunk) => chunk.sizeKb > RENDERER_CHUNK_SIZE_BUDGET_KB)

    expect(oversized).toHaveLength(1)
    expect(oversized[0].sizeKb).toBeGreaterThan(600)
  }, buildTimeoutMs)
})

describe('built renderer graph', () => {
  it('keeps every emitted chunk under the budget', { timeout: buildTimeoutMs }, async () => {
    const oversized = (await builtChunks())
      .filter((chunk) => chunk.sizeKb > RENDERER_CHUNK_SIZE_BUDGET_KB)
      .map((chunk) => `${chunk.fileName} ${chunk.sizeKb.toFixed(2)} kB`)

    expect(oversized).toEqual([])
  })

  it('emits the semantic vendor chunks alongside the entry chunk', { timeout: buildTimeoutMs }, async () => {
    const names = new Set((await builtChunks()).map((chunk) => chunk.name))

    expect([...names].sort()).toContain('index')
    for (const domain of RENDERER_CHUNK_DOMAINS) expect(names).toContain(domain.name)
  })

  it('never places one module in two chunks', { timeout: buildTimeoutMs }, async () => {
    expect(duplicatedModuleOwnership(await builtChunks())).toEqual([])
  })

  it('keeps the chunk import graph acyclic', { timeout: buildTimeoutMs }, async () => {
    expect(chunkImportCycles(await builtChunks())).toEqual([])
  })

  it('routes every bundled dependency to its declared domain', { timeout: buildTimeoutMs }, async () => {
    const misplaced = (await builtChunks()).flatMap((chunk: RendererChunk) =>
      chunk.moduleIds
        .map((moduleId) => ({ moduleId, packageName: packageNameOfModule(moduleId) }))
        .filter(({ packageName }) => packageName !== null)
        .filter(({ packageName }) => rendererChunkForPackage(packageName!) !== chunk.name)
        .map(({ moduleId }) => `${chunk.name} <- ${moduleId}`))

    expect(misplaced).toEqual([])
  })
})
