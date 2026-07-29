import fs from 'node:fs'
import { builtinModules } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync } from 'oxc-parser'
import { afterEach, describe, expect, it } from 'vitest'

import { resolutionCandidates } from './architecture-source-graph.mjs'

/**
 * The Electron preload runs in the sandboxed renderer.
 *
 * `require('node:*')` is unavailable there, and the preload body is one linear run of
 * `contextBridge.exposeInMainWorld` calls: a module that throws while the bundle
 * evaluates drops every API after it, so the renderer silently falls back to its
 * unavailable stubs and the window never becomes usable. Production builds tree-shake
 * an unused heavy import away and hide the fault; the development build the isolated
 * validation proof runs does not.
 *
 * The guard is therefore on the import graph, not on a bundle: no value-bearing edge
 * reachable from the preload entry may pull a Node built-in, a database driver, or
 * module persistence into the renderer.
 *
 * Every edge form the bundler honours is followed, because each one evaluates the
 * target: static import, `export ... from`, a literal dynamic `import()`, a CommonJS
 * `require()`, and a TypeScript `import x = require()`. Type-only edges are erased
 * before the bundle runs and are the only ones skipped. A dynamic or `require`
 * specifier that is not a literal cannot be read, so it is refused rather than
 * assumed safe.
 */
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const preloadEntry = path.join(repositoryRoot, 'electron/preload.ts')

/**
 * Node's own inventory, so no hand-written list can fall behind. Both spellings are
 * built-ins: `node:` may only prefix one, and the bare form resolves to the same
 * module. Subpaths such as `fs/promises` are matched by their root.
 */
const nodeBuiltins = new Set(builtinModules)
const FORBIDDEN_PACKAGE = /^(?:drizzle-orm(?:\/|$)|@electric-sql\/)/
const FORBIDDEN_FILE = /\.(?:schema|persistence|repository)\.ts$|(?:^|\/)(?:schema|pglite)\.ts$/

/**
 * @param {string} specifier
 * @returns {boolean}
 */
function isNodeBuiltin(specifier) {
  if (specifier.startsWith('node:')) return true
  return nodeBuiltins.has(specifier) || nodeBuiltins.has(specifier.split('/')[0] ?? '')
}

/**
 * @param {Record<string, any>} node
 * @param {(node: Record<string, any>) => void} visit
 * @returns {void}
 */
function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (!node || typeof node !== 'object') return
  if (typeof node.type === 'string') visit(node)
  for (const key of Object.keys(node)) {
    if (key !== 'type') walk(node[key], visit)
  }
}

/**
 * @param {Record<string, any>} node A declaration carrying a module source.
 * @returns {boolean} Whether the bundler erases it before evaluation.
 */
function isErasedDeclaration(node) {
  if (node.importKind === 'type' || node.exportKind === 'type') return true
  const specifiers = node.specifiers ?? []
  return specifiers.length > 0
    && specifiers.every((specifier) => specifier.importKind === 'type' || specifier.exportKind === 'type')
}

/**
 * @param {Record<string, any>} node
 * @returns {string | null} A literal specifier, or null when it is not a literal.
 */
function literalSpecifier(node) {
  return node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null
}

/**
 * Every specifier whose target the preload bundle evaluates.
 *
 * @param {string} filePath
 * @returns {{ specifiers: string[], computed: string[] }}
 */
function evaluatedSpecifiers(filePath) {
  const parsed = parseSync(filePath, fs.readFileSync(filePath, 'utf8'))
  if (parsed.errors.length > 0) {
    throw new Error(`${filePath} did not parse: ${parsed.errors.map((e) => e.message).join('; ')}`)
  }

  /** @type {string[]} */
  const specifiers = []
  /** @type {string[]} */
  const computed = []

  walk(parsed.program.body, (node) => {
    if (
      node.type === 'ImportDeclaration'
      || node.type === 'ExportNamedDeclaration'
      || node.type === 'ExportAllDeclaration'
    ) {
      const source = literalSpecifier(node.source)
      if (source !== null && !isErasedDeclaration(node)) specifiers.push(source)
      return
    }
    if (node.type === 'ImportExpression') {
      const source = literalSpecifier(node.source)
      if (source === null) computed.push('import()')
      else specifiers.push(source)
      return
    }
    if (node.type === 'TSImportEqualsDeclaration') {
      if (node.importKind === 'type') return
      const source = literalSpecifier(node.moduleReference?.expression)
      if (node.moduleReference?.type !== 'TSExternalModuleReference') return
      if (source === null) computed.push('import = require()')
      else specifiers.push(source)
      return
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'require') {
      const [argument] = node.arguments ?? []
      const source = literalSpecifier(argument)
      if (source === null) computed.push('require()')
      else specifiers.push(source)
    }
  })
  return { computed, specifiers }
}

/**
 * @param {string} entry Absolute path of the graph root.
 * @param {string} [root] Path the reported trail is written relative to.
 * @returns {{ closure: Set<string>, reaches: string[] }}
 */
export function rendererImportGraph(entry, root = repositoryRoot) {
  const label = (filePath) => path.relative(root, filePath).split(path.sep).join('/')
  const closure = new Set([entry])
  /** @type {string[]} */
  const reaches = []
  /** @type {{ file: string, trail: string[] }[]} */
  const stack = [{ file: entry, trail: [label(entry)] }]

  while (stack.length > 0) {
    const { file, trail } = /** @type {{ file: string, trail: string[] }} */ (stack.pop())
    const { computed, specifiers } = evaluatedSpecifiers(file)
    for (const form of computed) {
      reaches.push([...trail, `${form} with a specifier that is not a literal`].join(' -> '))
    }
    for (const specifier of specifiers) {
      if (isNodeBuiltin(specifier) || FORBIDDEN_PACKAGE.test(specifier)) {
        reaches.push([...trail, specifier].join(' -> '))
        continue
      }
      const candidates = resolutionCandidates(root, file, specifier)
      const resolved = candidates.find(
        (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
      )
      if (!resolved || closure.has(resolved)) continue
      const relative = label(resolved)
      if (FORBIDDEN_FILE.test(relative)) {
        reaches.push([...trail, relative].join(' -> '))
        continue
      }
      closure.add(resolved)
      stack.push({ file: resolved, trail: [...trail, relative] })
    }
  }
  return { closure, reaches }
}

/** @type {string[]} */
const fixtureRoots = []

/**
 * @param {Record<string, string>} files
 * @returns {{ entry: string, root: string }}
 */
function writeFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-preload-guard-'))
  fixtureRoots.push(root)
  for (const [filePath, source] of Object.entries(files)) {
    const absolutePath = path.join(root, filePath)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, source)
  }
  return { entry: path.join(root, 'entry.ts'), root }
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) fs.rmSync(root, { force: true, recursive: true })
})

describe('electron preload renderer safety', () => {
  it('reaches no Node built-in, database driver, or module persistence', () => {
    const { closure, reaches } = rendererImportGraph(preloadEntry)

    expect(closure.size).toBeGreaterThan(10)
    expect([...new Set(reaches)].sort()).toEqual([])
  })

  it('imports no capability module public surface', () => {
    const { closure } = rendererImportGraph(preloadEntry)
    const surfaces = [...closure]
      .map((file) => path.relative(repositoryRoot, file).split(path.sep).join('/'))
      .filter((file) => /^src\/modules\/[^/]+\/public\.ts$/.test(file))

    expect(surfaces).toEqual([])
  })
})

describe('electron preload renderer safety guard', () => {
  it('accepts a renderer-safe graph', () => {
    const fixture = writeFixture({
      'entry.ts': "import { value } from './helper'\nexport const api = value\n",
      'helper.ts': "import { z } from 'zod'\n\nexport const value = z\n",
    })

    expect(rendererImportGraph(fixture.entry, fixture.root).reaches).toEqual([])
  })

  it.each([
    ['a static prefixed built-in', "import fs from 'node:fs'\nexport const api = fs\n", 'node:fs'],
    ['a static unprefixed built-in', "import fs from 'fs'\nexport const api = fs\n", 'fs'],
    ['an unprefixed built-in subpath', "import fs from 'fs/promises'\nexport const api = fs\n", 'fs/promises'],
    ['a side-effect built-in import', "import 'node:crypto'\nexport const api = 1\n", 'node:crypto'],
    ['an export-from built-in', "export { readFile } from 'node:fs'\n", 'node:fs'],
    ['a literal dynamic import', "export const api = () => import('node:fs')\n", 'node:fs'],
    ['an unprefixed dynamic import', "export const api = () => import('crypto')\n", 'crypto'],
    ['a CommonJS require', "const fs = require('node:fs')\nexport const api = fs\n", 'node:fs'],
    ['an unprefixed CommonJS require', "const fs = require('path')\nexport const api = fs\n", 'path'],
    ['a TypeScript import-equals require', "import fs = require('node:fs')\nexport const api = fs\n", 'node:fs'],
    ['a database driver', "import { pgTable } from 'drizzle-orm/pg-core'\nexport const api = pgTable\n", 'drizzle-orm/pg-core'],
  ])('rejects %s', (_label, source, expected) => {
    const fixture = writeFixture({ 'entry.ts': source })

    expect(rendererImportGraph(fixture.entry, fixture.root).reaches).toEqual([`entry.ts -> ${expected}`])
  })

  it.each([
    ['a static import', "export { value } from './helper'\n"],
    ['a dynamic import', "export const api = () => import('./helper')\n"],
    ['a require', "const helper = require('./helper')\nexport const api = helper\n"],
    ['an import-equals require', "import helper = require('./helper')\nexport const api = helper\n"],
  ])('follows %s into a local helper that launders a built-in', (_label, source) => {
    const fixture = writeFixture({
      'entry.ts': source,
      'helper.ts': "import fs from 'node:fs'\n\nexport const value = fs\n",
    })

    expect(rendererImportGraph(fixture.entry, fixture.root).reaches).toEqual(['entry.ts -> helper.ts -> node:fs'])
  })

  it('follows a multi-hop dynamic laundering chain', () => {
    const fixture = writeFixture({
      'entry.ts': "export const api = () => import('./first')\n",
      'first.ts': "export const value = () => import('./second')\n",
      'second.ts': "import { pgTable } from 'drizzle-orm'\n\nexport const value = pgTable\n",
    })

    expect(rendererImportGraph(fixture.entry, fixture.root).reaches).toEqual([
      'entry.ts -> first.ts -> second.ts -> drizzle-orm',
    ])
  })

  it.each([
    ['a dynamic import', "const name = './x'\nexport const api = () => import(name)", 'import()'],
    ['a require', "const name = 'node:fs'\nexport const api = require(name)", 'require()'],
  ])('refuses %s whose specifier is not a literal', (_label, source, form) => {
    const fixture = writeFixture({ 'entry.ts': `${source}\n` })

    expect(rendererImportGraph(fixture.entry, fixture.root).reaches).toEqual([
      `entry.ts -> ${form} with a specifier that is not a literal`,
    ])
  })

  it.each([
    ['a type-only declaration', "import type fs from 'node:fs'\nexport type Api = typeof fs\n"],
    ['type-only specifiers', "import { type Stats } from 'node:fs'\nexport type Api = Stats\n"],
    ['a type-only export-from', "export type { Stats } from 'node:fs'\n"],
    ['a type-only import-equals', "import type fs = require('node:fs')\nexport type Api = typeof fs\n"],
  ])('erases %s', (_label, source) => {
    const fixture = writeFixture({ 'entry.ts': source })

    expect(rendererImportGraph(fixture.entry, fixture.root).reaches).toEqual([])
  })

  it('keeps a value specifier that shares a declaration with a type specifier', () => {
    const fixture = writeFixture({
      'entry.ts': "import { type Stats, readFile } from 'node:fs'\nexport const api = readFile\n",
    })

    expect(rendererImportGraph(fixture.entry, fixture.root).reaches).toEqual(['entry.ts -> node:fs'])
  })
})
