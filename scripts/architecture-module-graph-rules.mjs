import fs from 'node:fs'
import path from 'node:path'

import { moduleOfPath, readManifest } from './architecture-source-graph.mjs'
import {
  opaqueTableDeclarations,
  resolveStateExports,
  stateReaches,
} from './architecture-state-resolution.mjs'
import { loadStateOwnership, ownerByTable } from './architecture-state-ownership-rules.mjs'
import {
  MODULE_GRAPH_MANIFEST,
  findDuplicatePolicyEntries,
  findExceptionShapeViolations,
  findPermissionShapeViolations,
  policyByAccess,
} from './architecture-policy-rules.mjs'

export { MODULE_GRAPH_MANIFEST, RELAXABLE_RULES } from './architecture-policy-rules.mjs'

const moduleNamePattern = /^[a-z][a-z0-9-]*$/
const stampPattern = /^#\d+$/
const edgeKeys = new Set(['from', 'recordedIn', 'to'])
const testPathPattern = /\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/

/**
 * @typedef {object} ModuleGraphManifest
 * @property {string} moduleRoot
 * @property {string[]} stamps
 * @property {{ from: string, recordedIn: string, to: string }[]} edges
 * @property {Record<string, string>[]} exceptions
 */

/**
 * @param {string} root
 * @returns {ModuleGraphManifest | null}
 */
export function loadModuleGraph(root) {
  return /** @type {ModuleGraphManifest | null} */ (readManifest(root, MODULE_GRAPH_MANIFEST))
}

/**
 * The directed capability graph: production module source importing another
 * module. Test source is deliberately absent here — a test's imports describe a
 * scenario, not the shipped dependency direction — while state ownership below is
 * checked across every maintained file with no exemption at all.
 *
 * @param {import('./architecture-state-resolution.mjs').SourceScan} scan
 * @param {string} moduleRoot
 * @returns {Map<string, { source: string, target: string }>}
 */
export function observedModuleEdges(scan, moduleRoot) {
  /** @type {Map<string, { source: string, target: string }>} */
  const edges = new Map()
  for (const file of scan.files.values()) {
    if (!file.module || testPathPattern.test(file.path)) continue
    for (const target of file.targets.values()) {
      if (!target.startsWith(`${moduleRoot}/`)) continue
      const targetModule = moduleOfPath(target)
      if (!targetModule || targetModule === file.module) continue
      const key = `${file.module} -> ${targetModule}`
      if (!edges.has(key)) edges.set(key, { source: file.path, target })
    }
  }
  return edges
}

/**
 * Every reach into state a maintained file makes, attributed to exact tables.
 *
 * @param {import('./architecture-state-resolution.mjs').SourceScan} scan
 * @param {Map<string, string>} owners
 * @returns {{ accesses: Map<string, { owner: string, source: string, table: string, target: string, zone: string }>, refusals: string[] }}
 */
export function observedStateAccess(scan, owners) {
  const exportsByModule = resolveStateExports(scan)
  /** @type {Map<string, { owner: string, source: string, table: string, target: string, zone: string }>} */
  const accesses = new Map()
  /** @type {string[]} */
  const refusals = [...opaqueTableDeclarations(scan)]

  for (const file of scan.files.values()) {
    if (file.record.computedDynamicImport) {
      refusals.push(
        `[computed-module-import] ${file.path} imports a module whose specifier is computed; a target that cannot be read from the source cannot be stamped, so it is refused`,
      )
    }
    for (const reach of stateReaches(file, exportsByModule)) {
      if (reach.form === 'opaque') {
        refusals.push(
          `[opaque-state-import] ${file.path} reaches ${reach.target} through a ${reach.kind} import; owned tables must be named one by one so ownership stays attributable`,
        )
        continue
      }
      for (const table of reach.tables) {
        const owner = owners.get(table)
        if (!owner || owner === file.module) continue
        accesses.set(`${file.path}|${reach.target}|${table}`, {
          owner,
          source: file.path,
          table,
          target: reach.target,
          zone: file.zone,
        })
      }
    }
  }
  return { accesses, refusals: [...new Set(refusals)].sort() }
}

/**
 * @param {string} root
 * @param {ModuleGraphManifest} manifest
 * @returns {string[]}
 */
function findEdgeShapeViolations(root, manifest) {
  const stamps = new Set(Array.isArray(manifest.stamps) ? manifest.stamps : [])
  /** @type {Set<string>} */
  const seen = new Set()

  return [
    ...(Array.isArray(manifest.stamps) ? manifest.stamps : []).flatMap((stamp) =>
      stampPattern.test(stamp)
        ? []
        : [
          `[unstamped-module-edge] ${MODULE_GRAPH_MANIFEST} declares stamp ${JSON.stringify(stamp)}; a stamp must be an issue reference such as #326`,
        ],
    ),
    ...(manifest.edges ?? []).flatMap((edge) => {
      const label = `${edge?.from ?? '?'} -> ${edge?.to ?? '?'}`
      const extraKeys = Object.keys(edge ?? {}).filter((key) => !edgeKeys.has(key))
      if (extraKeys.length > 0) {
        return [
          `[unstamped-module-edge] ${MODULE_GRAPH_MANIFEST} edge ${label} carries unsupported fields ${extraKeys.sort().join(', ')}`,
        ]
      }
      if (!moduleNamePattern.test(edge?.from ?? '') || !moduleNamePattern.test(edge?.to ?? '')) {
        return [
          `[unstamped-module-edge] ${MODULE_GRAPH_MANIFEST} edge ${label} must name two exact modules; patterns and wildcards are not accepted`,
        ]
      }
      if (!stamps.has(edge.recordedIn)) {
        return [
          `[unstamped-module-edge] ${MODULE_GRAPH_MANIFEST} edge ${label} is not stamped by a declared issue reference`,
        ]
      }
      for (const moduleName of [edge.from, edge.to]) {
        if (!fs.existsSync(path.join(root, manifest.moduleRoot, moduleName))) {
          return [
            `[stale-module-edge] ${MODULE_GRAPH_MANIFEST} edge ${label} names missing module ${moduleName}`,
          ]
        }
      }
      if (seen.has(label)) {
        return [`[unstamped-module-edge] ${MODULE_GRAPH_MANIFEST} declares edge ${label} twice`]
      }
      seen.add(label)
      return []
    }),
  ]
}

/**
 * @param {string} root
 * @param {import('./architecture-state-resolution.mjs').SourceScan} scan
 * @returns {string[]}
 */
export function findModuleGraphViolations(root, scan) {
  const manifest = loadModuleGraph(root)
  if (!manifest) {
    return fs.existsSync(path.join(root, 'src', 'modules'))
      ? [`[missing-module-graph] ${MODULE_GRAPH_MANIFEST} is required while src/modules exists`]
      : []
  }

  const ownership = loadStateOwnership(root)
  const owners = ownership ? ownerByTable(ownership) : new Map()
  const policy = policyByAccess(manifest)
  const { accesses, refusals } = observedStateAccess(scan, owners)
  const observed = observedModuleEdges(scan, manifest.moduleRoot)
  const declaredEdges = new Set((manifest.edges ?? []).map((edge) => `${edge.from} -> ${edge.to}`))
  const ownerKinds = new Map(Object.entries(ownership?.owners ?? {}))

  return [
    ...refusals,
    ...findEdgeShapeViolations(root, manifest),
    ...findExceptionShapeViolations(root, manifest),
    ...findPermissionShapeViolations(root, manifest, ownerKinds),
    ...findDuplicatePolicyEntries(manifest),
    ...[...accesses].flatMap(([key, access]) => {
      const entry = policy.get(key)
      return entry && entry.owner === access.owner
        ? []
        : [
          `[foreign-owner-table-access] ${access.source} imports ${access.table} owned by ${access.owner}; zone ${access.zone} needs an exact entry in ${MODULE_GRAPH_MANIFEST}`,
        ]
    }),
    ...[...observed].flatMap(([edge, entry]) =>
      declaredEdges.has(edge)
        ? []
        : [
          `[undeclared-module-edge] ${entry.source} imports ${entry.target}; module edge ${edge} is not declared in ${MODULE_GRAPH_MANIFEST}`,
        ],
    ),
    ...[...declaredEdges].flatMap((edge) =>
      observed.has(edge)
        ? []
        : [
          `[stale-module-edge] ${MODULE_GRAPH_MANIFEST} declares edge ${edge}, which no production import supports`,
        ],
    ),
    ...(manifest.exceptions ?? []).flatMap((exception) =>
      accesses.has(`${exception.source}|${exception.target}|${exception.table}`)
        ? []
        : [
          `[stale-architecture-exception] ${MODULE_GRAPH_MANIFEST} exception ${exception.rule} ${exception.source} -> ${exception.target} for ${exception.table} matches no maintained import`,
        ],
    ),
    ...(manifest.permissions ?? []).flatMap((permission) =>
      accesses.has(`${permission.source}|${permission.target}|${permission.table}`)
        ? []
        : [
          `[stale-architecture-permission] ${MODULE_GRAPH_MANIFEST} permission ${permission.purpose} ${permission.source} -> ${permission.target} for ${permission.table} matches no maintained import`,
        ],
    ),
  ]
}
