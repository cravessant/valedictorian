/**
 * Renderer chunk policy.
 *
 * The renderer is split along package-domain boundaries rather than source
 * order so chunk ownership stays stable across dependency and refactor churn.
 * Domains are ordered leaf-first (`vendor-react` depends on nothing else here,
 * `vendor-connectors` depends on `vendor-data`) so Rollup never has to resolve
 * a cycle between manual chunks.
 */

/** Vite's default `chunkSizeWarningLimit`, in the kB unit Vite reports (1000 bytes). */
export const RENDERER_CHUNK_SIZE_BUDGET_KB = 500

/**
 * Vite's build reporter sizes a chunk as `Buffer.byteLength(chunk.code) / 1000`, which is
 * what the emitted asset weighs and what the large-chunk warning compares. Character count
 * understates every non-ASCII byte, so measure bytes.
 */
export function rendererChunkSizeKb(code: string): number {
  return Buffer.byteLength(code, 'utf8') / 1000
}

export interface RendererChunkDomain {
  /** Emitted chunk name; becomes the deterministic `assets/<name>-<hash>.js` prefix. */
  readonly name: string
  /** Why this domain is a separate chunk. */
  readonly rationale: string
  /** Exact package names owned by the domain. */
  readonly packages: readonly string[]
  /** Package scopes (`@scope`) owned wholesale by the domain. */
  readonly scopes?: readonly string[]
}

/** Chunk owning every dependency no domain claims, so classification is total. */
export const RENDERER_RESIDUAL_CHUNK = 'vendor-shared'

export const RENDERER_CHUNK_DOMAINS: readonly RendererChunkDomain[] = [
  {
    name: 'vendor-react',
    rationale: 'React runtime shared by every other chunk; must initialize first.',
    packages: ['react', 'react-dom', 'scheduler'],
  },
  {
    name: 'vendor-ui',
    rationale: 'Headless UI primitives, icons, and class utilities behind src/components/ui.',
    packages: [
      'aria-hidden',
      'class-variance-authority',
      'clsx',
      'cmdk',
      'get-nonce',
      'lucide-react',
      'react-remove-scroll',
      'react-remove-scroll-bar',
      'react-style-singleton',
      'sonner',
      'tailwind-merge',
      'use-callback-ref',
      'use-sidecar',
    ],
    scopes: ['@radix-ui', '@floating-ui'],
  },
  {
    name: 'vendor-data',
    rationale: 'Query cache, schema validation, and date handling used by workspace data views.',
    packages: ['date-fns', 'react-day-picker', 'zod'],
    scopes: ['@tanstack'],
  },
  {
    name: 'vendor-connectors',
    rationale: 'Connector SDK reached only through connector settings and sourcing.',
    scopes: ['@sparxie'],
    packages: [],
  },
]

/**
 * Resolves the installed package a module belongs to, tolerating pnpm's
 * `node_modules/.pnpm/<id>/node_modules/<name>` virtual store layout.
 */
export function packageNameOfModule(id: string): string | null {
  const marker = '/node_modules/'
  const start = id.lastIndexOf(marker)
  if (start === -1) return null
  const segments = id.slice(start + marker.length).split('/')
  const [first, second] = segments
  if (!first) return null
  if (!first.startsWith('@')) return first
  return second ? `${first}/${second}` : null
}

/**
 * Exact package claims are resolved before scope claims so carving one package
 * out of a claimed scope does not depend on where its domain sits in the list.
 */
export function rendererChunkForPackage(packageName: string): string {
  const named = RENDERER_CHUNK_DOMAINS.find((domain) => domain.packages.includes(packageName))
  if (named) return named.name
  if (!packageName.startsWith('@')) return RENDERER_RESIDUAL_CHUNK
  const scope = packageName.split('/')[0]
  const scoped = RENDERER_CHUNK_DOMAINS.find((domain) => domain.scopes?.includes(scope))
  return scoped?.name ?? RENDERER_RESIDUAL_CHUNK
}

/** Rollup `manualChunks`: app source stays in the entry chunk, dependencies split by domain. */
export function rendererManualChunk(id: string): string | undefined {
  const packageName = packageNameOfModule(id)
  if (!packageName) return undefined
  return rendererChunkForPackage(packageName)
}
