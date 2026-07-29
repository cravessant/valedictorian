import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { runArchitectureCheck } from './architecture-check.fixture.mjs'
import {
  loadModuleGraph,
  observedModuleEdges,
  observedStateAccess,
} from './architecture-module-graph-rules.mjs'
import { isMaintainedTestPath } from './architecture-policy-rules.mjs'
import { isProductionConsumer } from './architecture-public-surface-rules.mjs'
import { moduleOfPath } from './architecture-source-graph.mjs'
import {
  declarationRoot,
  loadStateOwnership,
  ownerByTable,
} from './architecture-state-ownership-rules.mjs'
import { declaredTables, scanMaintainedSource } from './architecture-state-resolution.mjs'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const ownership = /** @type {NonNullable<ReturnType<typeof loadStateOwnership>>} */ (
  loadStateOwnership(repositoryRoot)
)
const moduleGraph = /** @type {NonNullable<ReturnType<typeof loadModuleGraph>>} */ (
  loadModuleGraph(repositoryRoot)
)
const scan = scanMaintainedSource(repositoryRoot)
const observed = observedStateAccess(scan, ownerByTable(ownership))
const key = (entry) => `${entry.source}|${entry.target}|${entry.table}`

/** @type {string[]} */
const mirrorRoots = []

/**
 * A root that shares this repository's real `src` tree but owns a private copy of
 * `architecture/`, so a test can mutate the live manifests and see what the check
 * says about the live tree without touching the checked-in files.
 *
 * @param {(graph: any, state: any) => void} mutate
 * @returns {string}
 */
function mirrorRepository(mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-manifest-'))
  mirrorRoots.push(root)
  fs.symlinkSync(path.join(repositoryRoot, 'src'), path.join(root, 'src'), 'dir')

  const graph = structuredClone(moduleGraph)
  const state = structuredClone(ownership)
  mutate(graph, state)
  fs.mkdirSync(path.join(root, 'architecture'))
  fs.writeFileSync(path.join(root, 'architecture/module-graph.json'), JSON.stringify(graph))
  fs.writeFileSync(path.join(root, 'architecture/state-ownership.json'), JSON.stringify(state))
  return root
}

/**
 * A live foreign-owner access moved out of the stable permission set and recorded as
 * a transitional exception instead. The manifest carries no exception of its own, so
 * this is how the exception rules stay exercised against a real access.
 *
 * @param {any} graph Mutated to give up the permission the exception takes over.
 * @param {string} retiredBy
 * @returns {Record<string, string>}
 */
function asException(graph, retiredBy) {
  const [borrowed] = graph.permissions.filter(
    (entry) => entry.purpose === 'foreign-key-reference',
  )
  const { purpose: _purpose, ...rest } = borrowed
  graph.permissions = graph.permissions.filter((entry) => key(entry) !== key(borrowed))
  return { ...rest, retiredBy, rule: 'foreign-owner-table-access' }
}

afterEach(() => {
  for (const root of mirrorRoots.splice(0)) fs.rmSync(root, { recursive: true })
})

describe('checked-in architecture manifests', () => {
  it('accepts this repository', () => {
    const result = runArchitectureCheck(repositoryRoot)

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('reads every maintained file whole and refuses nothing in it', () => {
    expect(scan.failures).toEqual([])
    expect(observed.refusals).toEqual([])
    expect(scan.files.size).toBeGreaterThan(700)
  })

  it('owns every declared pgTable export and claims no other', () => {
    const declared = declaredTables(scan).map(
      (entry) => `${entry.schemaModule} ${entry.schemaExport} ${entry.table}`,
    )
    const claimed = Object.entries(ownership.tables).map(
      ([table, entry]) => `${entry.schemaModule} ${entry.schemaExport} ${table}`,
    )

    expect(claimed.sort()).toEqual(declared.sort())
    expect(claimed).toHaveLength(58)
    expect(ownership.schemaModules).toHaveLength(12)
  })

  it('records exactly the directed capability edges production source has', () => {
    const edges = observedModuleEdges(scan, moduleGraph.moduleRoot)

    expect(moduleGraph.edges.map((edge) => `${edge.from} -> ${edge.to}`).sort())
      .toEqual([...edges.keys()].sort())
    expect(moduleGraph.edges).toHaveLength(34)
  })

  it('covers every foreign state access exactly once, with no entry left over', () => {
    const entries = [...moduleGraph.exceptions, ...moduleGraph.permissions].map(key)

    expect(entries.sort()).toEqual([...observed.accesses.keys()].sort())
    expect(new Set(entries).size).toBe(entries.length)
  })

  it('keeps transitional exceptions and stable permissions separate and truthful', () => {
    expect(moduleGraph.exceptions).toEqual([])
    expect(moduleGraph.retiringIssues).toEqual([])
    expect(moduleGraph.permissions).toHaveLength(647)
    expect(moduleGraph.permissions.every((entry) => !('retiredBy' in entry))).toBe(true)
  })

  it('counts every stable permission under a purpose that fits its path', () => {
    const byPurpose = moduleGraph.permissions.reduce(
      (counts, entry) => ({ ...counts, [entry.purpose]: (counts[entry.purpose] ?? 0) + 1 }),
      {},
    )

    expect(byPurpose).toEqual({
      'cross-capability-state-access': 52,
      'foreign-key-reference': 16,
      'platform-ownership-root': 2,
      'schema-composition': 58,
      'schema-registration': 58,
      'test-state-access': 461,
    })
  })

  it('leaves no production server or runtime deep import to retire', () => {
    const productionReaches = [...observed.accesses.values()].filter(
      (access) => isProductionConsumer(access.source) && access.target.startsWith('src/modules/'),
    )

    expect(productionReaches).toEqual([])
    expect(moduleGraph.retiringIssues).not.toContain('#327')
  })

  it('has retired #328 and declares every table in an owning module', () => {
    const underDb = Object.entries(ownership.tables).filter(
      ([, entry]) => entry.schemaModule.startsWith('src/db/'),
    )

    expect(moduleGraph.exceptions.some((entry) => entry.retiredBy === '#328')).toBe(false)
    expect(moduleGraph.retiringIssues).not.toContain('#328')
    expect(underDb.map(([table]) => table)).toEqual(['workspaces'])
    expect(ownership.owners[ownership.tables.workspaces.owner].kind).toBe('platform')
    expect(ownership.tables.workspaces.schemaModule).toBe('src/db/workspaces.schema.ts')
    expect(declaredTables(scan).filter(
      (entry) => entry.schemaModule === moduleGraph.canonicalSchemaAggregate,
    )).toEqual([])
  })

  it('declares every capability table inside its own owner declaration root', () => {
    const misplaced = declaredTables(scan).filter((entry) => {
      const owner = ownership.owners[ownership.tables[entry.table].owner]
      return owner.kind === 'capability'
        && !entry.schemaModule.startsWith(`${declarationRoot(owner)}/`)
    })

    expect(misplaced).toEqual([])
  })

  it('records the applications declaration split and no other override', () => {
    const overrides = Object.entries(ownership.owners).filter(
      ([, entry]) => entry.declarationModule !== undefined,
    )

    expect(overrides.map(([owner, entry]) => `${owner}: ${entry.declarationModule}`))
      .toEqual(['applications: src/modules/application'])
    expect(ownership.owners.applications.module).toBe('src/modules/applications')
    expect(fs.existsSync(path.join(repositoryRoot, 'src/modules/applications/public.ts'))).toBe(true)
    expect(fs.existsSync(path.join(repositoryRoot, 'src/modules/application/public.ts'))).toBe(false)
  })

  it('pins every capability owner to its canonical module directory', () => {
    const byKind = (kind) => Object.entries(ownership.owners).filter(([, e]) => e.kind === kind)

    expect(byKind('capability').map(([owner, entry]) => `${owner} ${entry.module}`))
      .toEqual(byKind('capability').map(([owner]) => `${owner} src/modules/${owner}`))
    expect(byKind('platform').map(([, entry]) => entry.module)).toEqual([null])
  })

  it('rejects the live tree when a capability module is broadened to the module root', () => {
    const root = mirrorRepository((_graph, state) => {
      state.owners.job.module = 'src/modules'
    })

    const result = runArchitectureCheck(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[misowned-state-location] architecture/state-ownership.json gives capability owner job module src/modules, not its canonical module src/modules/job;',
    )
  })

  it('rejects the live tree when the applications declaration root is dropped', () => {
    const root = mirrorRepository((_graph, state) => {
      delete state.owners.applications.declarationModule
    })

    const result = runArchitectureCheck(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[misowned-state-location] src/modules/application/application.schema.ts declares applications, owned by capability applications, outside its declaration root src/modules/applications;',
    )
  })

  it('rejects the live tree when an owner claims a sibling capability as its root', () => {
    const root = mirrorRepository((_graph, state) => {
      state.owners.job.declarationModule = 'src/modules/capture'
    })

    const result = runArchitectureCheck(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "[misowned-state-location] architecture/state-ownership.json gives owner job declaration root src/modules/capture, which is capability capture's module;",
    )
  })

  it('rejects the live tree when a capability claims the src/db declaration', () => {
    const root = mirrorRepository((_graph, state) => {
      state.tables.workspaces.owner = 'policy'
    })

    const result = runArchitectureCheck(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[misowned-state-location] src/db/workspaces.schema.ts declares workspaces, owned by capability policy, outside its declaration root src/modules/policy;',
    )
  })

  it('never claims retirement for the canonical aggregate, the registrar, or a test', () => {
    const canonical = moduleGraph.exceptions.filter(
      (entry) => entry.source === moduleGraph.canonicalSchemaAggregate
        || entry.source === moduleGraph.schemaRegistrar
        || isMaintainedTestPath(entry.source),
    )

    expect(canonical).toEqual([])
  })

  it('records the registrar reach into the canonical aggregate table by table', () => {
    const registration = moduleGraph.permissions.filter(
      (entry) => entry.purpose === 'schema-registration',
    )

    expect(registration.every(
      (entry) => entry.source === moduleGraph.schemaRegistrar
        && entry.target === moduleGraph.canonicalSchemaAggregate,
    )).toBe(true)
    expect(new Set(registration.map((entry) => entry.table)).size).toBe(58)
  })

  it('rejects the tree when a declared edge is dropped', () => {
    const root = mirrorRepository((graph) => {
      graph.edges = graph.edges.filter((edge) => `${edge.from} -> ${edge.to}` !== 'capture -> job')
    })

    const result = runArchitectureCheck(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'module edge capture -> job is not declared in architecture/module-graph.json\n',
    )
  })

  it('rejects a stale edge entry', () => {
    const root = mirrorRepository((graph) => {
      graph.edges.push({ from: 'secrets', recordedIn: '#326', to: 'policy' })
    })

    const result = runArchitectureCheck(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[stale-module-edge] architecture/module-graph.json declares edge secrets -> policy, which no production import supports\n',
    )
  })

  it('routes every live production server and runtime reach through a public surface', () => {
    const reaches = [...scan.files.values()]
      .filter((file) => isProductionConsumer(file.path))
      .flatMap((file) => [...file.targets.values()])
      .filter((target) => target.startsWith('src/modules/'))
    const surfaces = new Set(reaches)

    expect(reaches.length).toBeGreaterThan(0)
    expect([...surfaces].filter(
      (target) => target !== `src/modules/${moduleOfPath(target)}/public.ts`,
    )).toEqual([])
    expect([...surfaces].every((target) => fs.existsSync(path.join(repositoryRoot, target))))
      .toBe(true)
  })

  it('rejects the live registrar reach when one aggregate member is dropped', () => {
    const root = mirrorRepository((graph) => {
      graph.permissions = graph.permissions.filter(
        (entry) => entry.source !== 'src/db/pglite.ts' || entry.table !== 'jobs',
      )
    })

    const result = runArchitectureCheck(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[foreign-owner-table-access] src/db/pglite.ts imports jobs owned by job; zone src/db needs an exact entry in architecture/module-graph.json\n',
    )
  })

  it('rejects a live permission moved to a purpose its path does not fit', () => {
    const root = mirrorRepository((graph) => {
      graph.permissions = graph.permissions.map((entry) =>
        entry.source === 'src/db/schema.ts' && entry.table === 'jobs'
          ? { ...entry, purpose: 'test-state-access' }
          : entry,
      )
    })

    const result = runArchitectureCheck(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'a test purpose may only be claimed by a maintained test or test-support path',
    )
  })

  it('rejects a live exception given an undeclared retiring issue', () => {
    const root = mirrorRepository((graph) => {
      graph.exceptions = [asException(graph, '#999')]
    })

    const result = runArchitectureCheck(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'claims retirement by #999, which is not a declared retiring issue',
    )
  })

  it('rejects a stale permission entry', () => {
    const root = mirrorRepository((graph) => {
      graph.permissions.push({
        ...graph.permissions[0],
        owner: 'job',
        purpose: 'schema-composition',
        source: 'src/db/schema.ts',
        table: 'jobs',
        target: 'src/modules/capture/capture.schema.ts',
      })
    })

    const result = runArchitectureCheck(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[stale-architecture-permission]')
  })

  it('rejects a stale ownership entry', () => {
    const root = mirrorRepository((_graph, state) => {
      state.tables.retired_state = {
        owner: 'policy',
        schemaExport: 'retiredState',
        schemaModule: 'src/db/schema.ts',
      }
    })

    const result = runArchitectureCheck(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[stale-state-ownership] architecture/state-ownership.json entry retired_state claims export retiredState in src/db/schema.ts, which no longer declares it\n',
    )
  })

  it('rejects the tree when an owner entry is dropped', () => {
    const root = mirrorRepository((_graph, state) => {
      delete state.tables.jobs
    })

    const result = runArchitectureCheck(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[unowned-state] src/modules/job/job.schema.ts exports jobs as jobs without a matching entry in architecture/state-ownership.json\n',
    )
  })

  it('records every cross-capability entry against a live cross-owner reach', () => {
    const crossCapability = moduleGraph.permissions.filter(
      (entry) => entry.purpose === 'cross-capability-state-access',
    )

    expect(crossCapability.every((entry) =>
      observed.accesses.has(key(entry))
        && entry.source.startsWith('src/modules/')
        && moduleOfPath(entry.source) !== entry.owner,
    )).toBe(true)
    expect(moduleGraph.permissions.some((entry) => entry.purpose.startsWith('cross-capability-w')))
      .toBe(false)
  })

  it('restricts every test purpose to a maintained test or support path', () => {
    const testEntries = moduleGraph.permissions.filter(
      (entry) => entry.purpose === 'test-state-access',
    )

    expect(testEntries.every((entry) =>
      isMaintainedTestPath(entry.source) && observed.accesses.has(key(entry)),
    )).toBe(true)
  })

  it('rejects a live access rerecorded as a transitional exception', () => {
    const root = mirrorRepository((graph) => {
      graph.exceptions = [asException(graph, '#900')]
      graph.retiringIssues = ['#900']
    })

    const result = runArchitectureCheck(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'claims retirement by #900, which only covers nothing this check models',
    )
  })

  it('declares no runtime-analysis fields', () => {
    expect('stateConsumingMethods' in moduleGraph).toBe(false)
    expect('registrationBoundaries' in moduleGraph).toBe(false)
  })

  it('declares every physical table exactly once', () => {
    const declared = declaredTables(scan)
    const tables = declared.map((entry) => entry.table)
    const identities = declared.map((entry) => `${entry.schemaModule}:${entry.schemaExport}`)

    expect(new Set(tables).size).toBe(tables.length)
    expect(new Set(identities).size).toBe(identities.length)
    expect(declared).toHaveLength(58)
  })

  it('stamps every edge, exception, and permission', () => {
    const stamps = new Set(moduleGraph.stamps)

    expect(moduleGraph.stamps).toEqual(['#326', '#328'])
    expect(moduleGraph.edges.every((edge) => stamps.has(edge.recordedIn))).toBe(true)
    expect([...moduleGraph.exceptions, ...moduleGraph.permissions]
      .every((entry) => stamps.has(entry.recordedIn))).toBe(true)
    expect(moduleGraph.exceptions.every((entry) => entry.recordedIn === '#326')).toBe(true)
  })

  it('runs inside the single lint path', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
    )

    expect(manifest.scripts['architecture:check']).toBe('node scripts/architecture-check.mjs')
    expect(manifest.scripts.lint).toContain('pnpm run architecture:check')
    expect(manifest.devDependencies['oxc-parser']).toBe('0.141.0')
    expect(manifest.devDependencies['es-module-lexer']).toBe('2.2.0')
  })
})
