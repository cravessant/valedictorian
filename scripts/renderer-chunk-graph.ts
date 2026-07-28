import { fileURLToPath } from 'node:url'
import {
  build,
  loadConfigFromFile,
  type Plugin,
  type PluginOption,
  type Rollup,
  type UserConfig,
} from 'vite'
import { rendererChunkSizeKb } from './renderer-chunk-policy'

export interface RendererChunk {
  readonly name: string
  readonly fileName: string
  readonly sizeKb: number
  readonly imports: readonly string[]
  readonly moduleIds: readonly string[]
}

export interface RendererGraphConfig {
  /** The config exactly as the loading environment evaluated it. */
  readonly config: UserConfig
  /** Plugins the graph build runs, after the Electron side builders are dropped. */
  readonly plugins: readonly Plugin[]
  readonly pluginNames: readonly string[]
}

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

export const RENDERER_CONFIG_FILE = fileURLToPath(new URL('../vite.config.ts', import.meta.url))

/**
 * Loads and evaluates a checked-in Vite config through Vite's own config loader, so the
 * graph sees whatever the config decides at evaluation time. This repository's config
 * registers `vite-plugin-electron-renderer` only when `NODE_ENV` is not `test`, and a
 * static `import` would freeze that decision under the runner's environment; switching
 * mode afterwards cannot bring a plugin back that was never constructed.
 *
 * The Electron main and preload builders are dropped because they run their own writing
 * builds that this graph does not describe. Every other plugin, including the production
 * renderer plugin, is kept so the measured graph stays the production graph.
 */
export async function loadGraphConfig(configFile: string): Promise<RendererGraphConfig> {
  const loaded = await loadConfigFromFile(
    { command: 'build', isPreview: false, isSsrBuild: false, mode: 'production' },
    configFile,
    repositoryRoot,
    'silent',
  )
  if (!loaded) throw new Error(`Vite could not load ${configFile}`)
  const plugins = (await flattenPlugins(loaded.config.plugins ?? []))
    .filter((plugin) => plugin.name !== electronBuilderPluginName)
  return { config: loaded.config, pluginNames: plugins.map((plugin) => plugin.name), plugins }
}

/** Builds a config in memory and reports its emitted chunks. */
export async function buildGraphChunks(configFile: string): Promise<RendererChunk[]> {
  const { config, plugins } = await loadGraphConfig(configFile)
  const output = await build({
    ...config,
    // Defaulting `base` is the one renderer-visible effect of the dropped Electron build
    // plugin, so restore it rather than measure a graph with absolute asset references.
    base: config.base ?? './',
    build: { ...config.build, write: false },
    configFile: false,
    logLevel: 'silent',
    mode: 'production',
    plugins: [...plugins],
  })
  const bundles = Array.isArray(output) ? output : [output]
  if (bundles.length !== 1 || !('output' in bundles[0])) {
    throw new Error('Expected exactly one Rollup bundle')
  }
  return bundles[0].output
    .filter((asset): asset is Rollup.OutputChunk => asset.type === 'chunk')
    .map((chunk) => ({
      fileName: chunk.fileName,
      imports: chunk.imports,
      moduleIds: Object.keys(chunk.modules),
      name: chunk.name,
      sizeKb: rendererChunkSizeKb(chunk.code),
    }))
}

export function loadRendererGraphConfig(): Promise<RendererGraphConfig> {
  return withProductionNodeEnv(() => loadGraphConfig(RENDERER_CONFIG_FILE))
}

/** Builds the renderer in memory with the checked-in config, as production evaluates it. */
export function buildRendererChunks(): Promise<RendererChunk[]> {
  return withProductionNodeEnv(() => buildGraphChunks(RENDERER_CONFIG_FILE))
}

/**
 * Vite, the React plugin, and this repository's config all read `process.env.NODE_ENV`
 * rather than the requested mode. The runner sets it to `test`, which would measure a
 * development renderer against a production budget.
 */
export async function withProductionNodeEnv<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    return await run()
  } finally {
    process.env.NODE_ENV = previous
  }
}

/** `vite-plugin-electron/simple` registers under this name once per built Electron entry. */
const electronBuilderPluginName = 'vite-plugin-electron'

/** The plugin `vite-plugin-electron/simple` adds only outside a `test` evaluation. */
export const ELECTRON_RENDERER_PLUGIN_NAME = 'vite-plugin-electron-renderer'

async function flattenPlugins(plugins: readonly PluginOption[]): Promise<Plugin[]> {
  const resolved = await Promise.all(plugins.map(async (option) => {
    const plugin = await option
    if (!plugin) return []
    return Array.isArray(plugin) ? flattenPlugins(plugin) : [plugin]
  }))
  return resolved.flat()
}

/** Names of chunks that participate in an import cycle, empty when the graph is acyclic. */
export function chunkImportCycles(chunks: readonly RendererChunk[]): string[][] {
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
  const cycles: string[][] = []
  const settled = new Set<string>()
  const stack: string[] = []

  function visit(fileName: string) {
    const position = stack.indexOf(fileName)
    if (position !== -1) {
      cycles.push(stack.slice(position).concat(fileName))
      return
    }
    if (settled.has(fileName)) return
    stack.push(fileName)
    for (const imported of byFile.get(fileName)?.imports ?? []) visit(imported)
    stack.pop()
    settled.add(fileName)
  }

  for (const chunk of chunks) visit(chunk.fileName)
  return cycles
}

/** Module ids owned by more than one chunk, which would mean duplicated code. */
export function duplicatedModuleOwnership(chunks: readonly RendererChunk[]): string[] {
  const owners = new Map<string, string[]>()
  for (const chunk of chunks) {
    for (const moduleId of chunk.moduleIds) {
      owners.set(moduleId, [...(owners.get(moduleId) ?? []), chunk.fileName])
    }
  }
  return [...owners].filter(([, files]) => files.length > 1).map(([moduleId]) => moduleId)
}
