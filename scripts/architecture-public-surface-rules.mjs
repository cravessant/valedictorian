import fs from 'node:fs'
import path from 'node:path'

import { isTestPath, moduleOfPath, resolutionCandidates } from './architecture-source-graph.mjs'

/** The one convention, hard-coded: a module's whole external contract is this file. */
export const PUBLIC_SURFACE_FILE = 'public.ts'

/** Where production composition lives. Everything maintained under these is scanned. */
export const CONSUMER_ROOTS = ['src/runtime/', 'src/server/']

/** Edges a public surface must not reach, so a contract cannot depend on its consumers. */
const FORBIDDEN_SURFACE_ROOTS = ['src/ipc/', 'src/runtime/', 'src/server/']

export const PUBLIC_SURFACE_RULE = 'module-public-surface-bypass'

const MODULE_ROOT = 'src/modules'
const electronPattern = /^electron(?:\/|$)/
const moduleSpecifierPattern = /(?:^|\/)modules\//

/**
 * @param {string} repositoryPath
 * @returns {boolean}
 */
function isPublicSurface(repositoryPath) {
  const moduleName = moduleOfPath(repositoryPath)
  return moduleName !== null && repositoryPath === `${MODULE_ROOT}/${moduleName}/${PUBLIC_SURFACE_FILE}`
}

/**
 * @param {string} repositoryPath
 * @returns {boolean}
 */
function isModuleInternal(repositoryPath) {
  return repositoryPath.startsWith(`${MODULE_ROOT}/`) && !isPublicSurface(repositoryPath)
}

/**
 * @param {string} repositoryPath
 * @returns {boolean}
 */
export function isProductionConsumer(repositoryPath) {
  return CONSUMER_ROOTS.some((root) => repositoryPath.startsWith(root))
    && !isTestPath(repositoryPath)
}

/**
 * The real path a specifier names, with every symlink collapsed.
 *
 * Resolution mirrors the TypeScript `@/* -> ./src/*` mapping and the extension and
 * index spellings the bundler accepts, then canonicalises the result: a symlink
 * pointing into a module resolves to the module file it really is, so a link
 * cannot launder a deep import. A specifier that reaches nothing is reported as
 * unresolved rather than guessed at.
 *
 * @param {string} realRoot
 * @param {string} filePath Absolute path of the importing file.
 * @param {string} specifier
 * @returns {{ kind: 'external' } | { kind: 'unresolved' } | { kind: 'file', repositoryPath: string }}
 */
function resolveRealTarget(realRoot, filePath, specifier) {
  const candidates = resolutionCandidates(realRoot, filePath, specifier)
  if (candidates.length === 0) return { kind: 'external' }

  const resolved = candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  )
  if (!resolved) return { kind: 'unresolved' }

  const real = fs.realpathSync.native(resolved)
  return { kind: 'file', repositoryPath: path.relative(realRoot, real).split(path.sep).join('/') }
}

/**
 * The canonical spelling of a public surface: the exact path, no extension, no
 * index form, and no redundant segment. Two spellings of one file would make the
 * contract unauditable by reading, so only the canonical one is accepted even
 * though every spelling resolves alike.
 *
 * @param {string} specifier
 * @returns {boolean}
 */
function isCanonicalSurfaceSpelling(specifier) {
  const surfaceName = PUBLIC_SURFACE_FILE.replace(/\.ts$/, '')
  return specifier.endsWith(`/${surfaceName}`)
    && path.posix.normalize(specifier) === specifier
}

/**
 * Every module-internal export a maintained file hands on.
 *
 * A barrel is transport whatever shape it takes: `export { a } from`, a rename,
 * `export type { T } from`, `export * from`, `export * as ns from`, a default, or
 * an import bound locally and then exported. Barrels of barrels are followed to a
 * fixpoint, so a second hop hides nothing that a first hop would not, and module
 * files carry no exemption — a module barrel launders as readily as any other.
 *
 * One file absorbs rather than carries: a public surface is exactly the place its
 * own module's internals are meant to become public, so it drops those origins and
 * keeps every foreign one. That makes a surface re-exporting another module's
 * internal file visible both on the surface and at every consumer of it.
 *
 * @param {import('./architecture-state-resolution.mjs').SourceScan} scan
 * @param {Map<string, Map<string, ReturnType<typeof resolveRealTarget>>>} targets
 * @returns {Map<string, Set<string>>} Carrier file -> module-internal origins.
 */
function moduleTransports(scan, targets) {
  /** @type {Map<string, Set<string>>} */
  const transports = new Map()

  const forwarded = (file) => {
    /** @type {string[]} */
    const specifiers = file.record.syntax.reexports.map((entry) => entry.specifier)
    const exportedLocals = new Set(file.record.syntax.localExports.map((entry) => entry.local))
    for (const statement of file.record.syntax.staticImports) {
      if (statement.entries.some((entry) => exportedLocals.has(entry.local))) {
        specifiers.push(statement.specifier)
      }
    }
    return specifiers
  }

  for (let changed = true; changed;) {
    changed = false
    for (const file of scan.files.values()) {
      const ownModule = isPublicSurface(file.path) ? moduleOfPath(file.path) : null
      /** @type {Set<string>} */
      const origins = new Set()
      for (const specifier of forwarded(file)) {
        const target = targets.get(file.path)?.get(specifier)
        if (target?.kind !== 'file') continue
        const carried = isModuleInternal(target.repositoryPath)
          ? [target.repositoryPath]
          : [...transports.get(target.repositoryPath) ?? []]
        for (const origin of carried) {
          if (ownModule !== null && moduleOfPath(origin) === ownModule) continue
          origins.add(origin)
        }
      }
      const previous = transports.get(file.path)
      if (!previous || previous.size !== origins.size || [...origins].some((o) => !previous.has(o))) {
        transports.set(file.path, origins)
        changed = true
      }
    }
  }
  return transports
}

/**
 * Every forbidden edge reachable from a public surface, with the path that reaches
 * it.
 *
 * A surface's contract is its whole dependency closure, not its first line: a
 * capability that reaches its own consumer two hops down has still inverted the
 * dependency, and a type-only hop or an intermediate file hides nothing. The walk
 * is breadth-first so the reported path is the shortest one, and it is cycle-safe.
 *
 * @param {string} surface
 * @param {import('./architecture-state-resolution.mjs').SourceScan} scan
 * @param {Map<string, Map<string, ReturnType<typeof resolveRealTarget>>>} targets
 * @returns {string[]}
 */
function surfaceClosureViolations(surface, scan, targets) {
  /** @type {string[]} */
  const violations = []
  const seen = new Set([surface])
  /** @type {{ path: string, trail: string[] }[]} */
  let frontier = [{ path: surface, trail: [surface] }]

  while (frontier.length > 0) {
    /** @type {{ path: string, trail: string[] }[]} */
    const next = []
    for (const { path: current, trail } of frontier) {
      const file = scan.files.get(current)
      if (!file) continue
      for (const specifier of declaredSpecifiers(file)) {
        if (electronPattern.test(specifier)) {
          violations.push(
            `[${PUBLIC_SURFACE_RULE}] ${surface} depends on Electron through ${[...trail, JSON.stringify(specifier)].join(' -> ')}; a public surface carries no Electron edge anywhere in its closure`,
          )
          continue
        }
        const target = targets.get(current)?.get(specifier)
        if (target?.kind !== 'file' || seen.has(target.repositoryPath)) continue
        const forbidden = FORBIDDEN_SURFACE_ROOTS.find(
          (edge) => target.repositoryPath.startsWith(edge),
        )
        if (forbidden) {
          violations.push(
            `[${PUBLIC_SURFACE_RULE}] ${surface} depends on ${forbidden.replace(/\/$/, '')} through ${[...trail, target.repositoryPath].join(' -> ')}; no file in a public surface's closure reaches its own consumer`,
          )
          continue
        }
        seen.add(target.repositoryPath)
        next.push({ path: target.repositoryPath, trail: [...trail, target.repositoryPath] })
      }
    }
    frontier = next
  }
  return violations
}

/**
 * The export forms a public surface may use.
 *
 * A contract is only auditable if reading it names everything it hands out, so a
 * star, a namespace, and a default are all refused; explicit named value and type
 * exports are the whole vocabulary.
 *
 * @param {import('./architecture-state-resolution.mjs').ScannedFile} file
 * @returns {string[]}
 */
function surfaceExportFormViolations(file) {
  /** @type {string[]} */
  const violations = []
  for (const reexport of file.record.syntax.reexports) {
    if (reexport.imported === 'all') {
      violations.push(
        `[${PUBLIC_SURFACE_RULE}] ${file.path} re-exports ${JSON.stringify(reexport.specifier)} as ${reexport.exported === null ? 'a star' : 'a namespace'}; a public surface names every export explicitly`,
      )
    }
  }
  if (file.record.syntax.defaultExport) {
    violations.push(
      `[${PUBLIC_SURFACE_RULE}] ${file.path} exports a default binding; a public surface names every export explicitly`,
    )
  }
  return violations
}

/**
 * Production server and runtime composition reaches a capability only through its
 * exact `src/modules/<module>/public.ts` surface (issue #327, decision 0001).
 *
 * Every maintained non-test file under `src/runtime` and `src/server` is scanned,
 * whatever it is named: a file called fixture or harness ships as readily as one
 * that is not, so no filename convention exempts it, and every TypeScript
 * extension the toolchain accepts is read. Static imports, static re-exports, and
 * literal dynamic imports are all module declarations and all checked alike.
 *
 * A reach is rejected when it lands on a module file that is not that module's
 * public surface, when it lands on the surface by a non-canonical spelling, when a
 * symlink or an index or extension form disguises the target, or when any carrier
 * — module barrel or not — hands a module internal across in its place.
 *
 * Each surface is checked in its own right on three counts: its whole transitive
 * dependency closure reaches no runtime, server, IPC, or Electron edge, so a
 * capability cannot depend on its own consumer however many hops away; it
 * transports no other module's internal file, so one contract cannot publish
 * another's; and it exports only explicit named values and types, so no star,
 * namespace, or default hides what it hands out.
 *
 * Anything unreadable fails closed: a computed dynamic specifier and a specifier
 * naming a module that resolves to nothing are refused by name rather than
 * skipped.
 *
 * @param {string} root
 * @param {import('./architecture-state-resolution.mjs').SourceScan} scan
 * @returns {string[]}
 */
export function findPublicSurfaceViolations(root, scan) {
  const realRoot = fs.realpathSync.native(root)

  /** @type {Map<string, Map<string, ReturnType<typeof resolveRealTarget>>>} */
  const targets = new Map()
  for (const file of scan.files.values()) {
    const absolutePath = path.join(realRoot, file.path)
    /** @type {Map<string, ReturnType<typeof resolveRealTarget>>} */
    const resolved = new Map()
    for (const specifier of declaredSpecifiers(file)) {
      resolved.set(specifier, resolveRealTarget(realRoot, absolutePath, specifier))
    }
    targets.set(file.path, resolved)
  }

  const transports = moduleTransports(scan, targets)
  /** @type {string[]} */
  const violations = []

  for (const file of scan.files.values()) {
    if (isPublicSurface(file.path)) {
      violations.push(
        ...surfaceExportFormViolations(file),
        ...surfaceClosureViolations(file.path, scan, targets),
        ...surfaceTransportViolations(file, transports),
      )
    }
    if (!isProductionConsumer(file.path)) continue

    if (file.record.computedDynamicImport) {
      violations.push(
        `[${PUBLIC_SURFACE_RULE}] ${file.path} imports a module whose specifier is computed; a reach that cannot be read from the source cannot be proven to use a public surface`,
      )
    }
    for (const specifier of declaredSpecifiers(file)) {
      violations.push(...consumerViolations(file, specifier, targets, transports))
    }
  }
  return [...new Set(violations)].sort()
}

/**
 * @param {import('./architecture-state-resolution.mjs').ScannedFile} file
 * @returns {string[]}
 */
function declaredSpecifiers(file) {
  const syntax = file.record.syntax
  return [...new Set([
    ...syntax.staticImports.map((statement) => statement.specifier),
    ...syntax.reexports.map((entry) => entry.specifier),
    ...syntax.dynamicSpecifiers,
  ])]
}

/**
 * @param {import('./architecture-state-resolution.mjs').ScannedFile} file
 * @param {string} specifier
 * @param {Map<string, Map<string, ReturnType<typeof resolveRealTarget>>>} targets
 * @param {Map<string, Set<string>>} transports
 * @returns {string[]}
 */
function consumerViolations(file, specifier, targets, transports) {
  const target = targets.get(file.path)?.get(specifier)
  if (!target || target.kind === 'external') return []
  if (target.kind === 'unresolved') {
    return moduleSpecifierPattern.test(specifier) || specifier.startsWith('@/modules/')
      ? [
        `[${PUBLIC_SURFACE_RULE}] ${file.path} names module specifier ${JSON.stringify(specifier)}, which resolves to no file; an unresolvable reach is refused rather than assumed to be a public surface`,
      ]
      : []
  }

  const { repositoryPath } = target
  if (repositoryPath.startsWith(`${MODULE_ROOT}/`)) {
    const moduleName = moduleOfPath(repositoryPath)
    const surface = `${MODULE_ROOT}/${moduleName}/${PUBLIC_SURFACE_FILE}`
    if (isModuleInternal(repositoryPath)) {
      return [
        `[${PUBLIC_SURFACE_RULE}] ${file.path} reaches ${repositoryPath} through ${JSON.stringify(specifier)}; production server and runtime code imports a capability only through ${surface}`,
      ]
    }
    if (!isCanonicalSurfaceSpelling(specifier)) {
      return [
        `[${PUBLIC_SURFACE_RULE}] ${file.path} reaches ${surface} through ${JSON.stringify(specifier)}; the surface is imported by its exact path with no extension, index, or redundant segment`,
      ]
    }
    // A surface carries only what belongs to another module; its own module's
    // internals are absorbed, so anything left here is laundered.
    return barrelViolations(file, repositoryPath, transports)
  }

  return barrelViolations(file, repositoryPath, transports)
}

/**
 * @param {import('./architecture-state-resolution.mjs').ScannedFile} file
 * @param {string} repositoryPath
 * @param {Map<string, Set<string>>} transports
 * @returns {string[]}
 */
function barrelViolations(file, repositoryPath, transports) {
  const carried = transports.get(repositoryPath)
  return carried && carried.size > 0
    ? [...carried].sort().map((origin) =>
      `[${PUBLIC_SURFACE_RULE}] ${file.path} reaches ${origin} through the barrel ${repositoryPath}; a re-export carries a module internal across the boundary that ${MODULE_ROOT}/${moduleOfPath(origin)}/${PUBLIC_SURFACE_FILE} exists to hold`,
    )
    : []
}

/**
 * A public surface may publish its own module and no other. Anything foreign it
 * forwards belongs to the owning module's surface, however many hops away it was
 * bound, renamed, or typed.
 *
 * @param {import('./architecture-state-resolution.mjs').ScannedFile} file
 * @param {Map<string, Set<string>>} transports
 * @returns {string[]}
 */
function surfaceTransportViolations(file, transports) {
  return [...transports.get(file.path) ?? []].sort().map((origin) =>
    `[${PUBLIC_SURFACE_RULE}] ${file.path} transports ${origin}; a public surface publishes its own module only, and ${MODULE_ROOT}/${moduleOfPath(origin)}/${PUBLIC_SURFACE_FILE} owns that contract`,
  )
}
