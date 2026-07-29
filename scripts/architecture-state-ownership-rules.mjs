import fs from 'node:fs'
import path from 'node:path'

import { readManifest } from './architecture-source-graph.mjs'
import { declaredTables, misplacedTableCalls } from './architecture-state-resolution.mjs'

export const STATE_OWNERSHIP_MANIFEST = 'architecture/state-ownership.json'

const ownerNamePattern = /^[a-z][a-z0-9-]*$/
const ownerKinds = new Set(['capability', 'platform'])
const tableEntryKeys = new Set(['owner', 'schemaExport', 'schemaModule'])
const ownerEntryKeys = new Set(['kind', 'module'])

/**
 * @typedef {object} TableOwnership
 * @property {string} owner
 * @property {string} schemaExport
 * @property {string} schemaModule
 */

/**
 * @typedef {object} StateOwnershipManifest
 * @property {Record<string, { kind: string, module: string | null }>} owners
 * @property {string[]} schemaModules
 * @property {Record<string, TableOwnership>} tables
 */

/**
 * @param {string} root
 * @returns {StateOwnershipManifest | null}
 */
export function loadStateOwnership(root) {
  return /** @type {StateOwnershipManifest | null} */ (
    readManifest(root, STATE_OWNERSHIP_MANIFEST)
  )
}

/**
 * @param {StateOwnershipManifest} manifest
 * @returns {Map<string, string>} Physical table name -> owner.
 */
export function ownerByTable(manifest) {
  return new Map(
    Object.entries(manifest.tables ?? {}).map(([table, entry]) => [table, entry.owner]),
  )
}

/**
 * @param {string} root
 * @param {StateOwnershipManifest} manifest
 * @returns {string[]}
 */
function findManifestShapeViolations(root, manifest) {
  const declaredOwners = new Set(Object.keys(manifest.owners ?? {}))
  return [
    ...Object.entries(manifest.owners ?? {}).flatMap(([owner, entry]) => {
      const extraKeys = Object.keys(entry).filter((key) => !ownerEntryKeys.has(key))
      if (!ownerNamePattern.test(owner) || !ownerKinds.has(entry.kind) || extraKeys.length > 0) {
        return [
          `[unknown-state-owner] ${STATE_OWNERSHIP_MANIFEST} declares owner ${owner} with an unusable shape; each owner needs a kebab-case name, a capability or platform kind, and no other fields`,
        ]
      }
      if (entry.kind === 'capability' && !fs.existsSync(path.join(root, entry.module ?? ''))) {
        return [
          `[unknown-state-owner] ${STATE_OWNERSHIP_MANIFEST} declares capability owner ${owner} at missing module directory ${entry.module}`,
        ]
      }
      return []
    }),
    ...Object.entries(manifest.tables ?? {}).flatMap(([table, ownership]) => {
      const extraKeys = Object.keys(ownership).filter((key) => !tableEntryKeys.has(key))
      if (extraKeys.length > 0) {
        return [
          `[unknown-state-owner] ${STATE_OWNERSHIP_MANIFEST} entry ${table} carries unsupported fields ${extraKeys.sort().join(', ')}`,
        ]
      }
      if (!declaredOwners.has(ownership.owner)) {
        return [
          `[unknown-state-owner] ${STATE_OWNERSHIP_MANIFEST} entry ${table} names undeclared owner ${ownership.owner}`,
        ]
      }
      return []
    }),
  ]
}

/**
 * @param {string} root
 * @param {import('./architecture-state-resolution.mjs').SourceScan} scan
 * @returns {string[]}
 */
export function findStateOwnershipViolations(root, scan) {
  const manifest = loadStateOwnership(root)
  const declared = declaredTables(scan)
  if (!manifest) {
    return declared.length === 0
      ? []
      : [
        `[missing-state-ownership] ${STATE_OWNERSHIP_MANIFEST} is required while src declares pgTable state`,
      ]
  }

  const identity = (entry) => `${entry.schemaModule}|${entry.schemaExport}|${entry.table}`
  const claimed = Object.entries(manifest.tables ?? {}).map(([table, entry]) => ({
    schemaExport: entry.schemaExport,
    schemaModule: entry.schemaModule,
    table,
  }))
  const claimedIdentities = new Set(claimed.map(identity))
  const listedModules = new Set(manifest.schemaModules ?? [])
  const declaringModules = new Set(declared.map((entry) => entry.schemaModule))

  return [
    ...misplacedTableCalls(scan),
    ...findDuplicateDeclarations(declared),
    ...findManifestShapeViolations(root, manifest),
    ...declared.flatMap((entry) =>
      claimedIdentities.has(identity(entry))
        ? []
        : [
          `[unowned-state] ${entry.schemaModule} exports ${entry.table} as ${entry.schemaExport} without a matching entry in ${STATE_OWNERSHIP_MANIFEST}`,
        ],
    ),
    ...claimed.flatMap((entry) =>
      declared.some((live) => identity(live) === identity(entry))
        ? []
        : [
          `[stale-state-ownership] ${STATE_OWNERSHIP_MANIFEST} entry ${entry.table} claims export ${entry.schemaExport} in ${entry.schemaModule}, which no longer declares it`,
        ],
    ),
    ...[...declaringModules].flatMap((schemaModule) =>
      listedModules.has(schemaModule)
        ? []
        : [
          `[undeclared-schema-module] ${schemaModule} declares tables but is absent from ${STATE_OWNERSHIP_MANIFEST}`,
        ],
    ),
    ...[...listedModules].flatMap((schemaModule) =>
      declaringModules.has(schemaModule)
        ? []
        : [
          `[undeclared-schema-module] ${STATE_OWNERSHIP_MANIFEST} lists ${schemaModule}, which declares no table`,
        ],
    ),
  ]
}

/**
 * A physical table name, or a schema export identity, declared more than once.
 *
 * Ownership is one owner per table, so a second declaration of the same physical
 * name is ambiguous wherever it lives, and two declarations sharing a module and
 * export identifier cannot both be addressed. Both locations are named so the
 * failure is actionable and deterministic.
 *
 * @param {import('./architecture-state-resolution.mjs').TableDeclaration[]} declared
 * @returns {string[]}
 */
function findDuplicateDeclarations(declared) {
  const site = (entry) => `${entry.schemaModule}:${entry.schemaExport}`
  const group = (key) => declared.reduce((groups, entry) => {
    const id = key(entry)
    groups.set(id, [...(groups.get(id) ?? []), entry])
    return groups
  }, /** @type {Map<string, import('./architecture-state-resolution.mjs').TableDeclaration[]>} */ (new Map()))

  return [
    ...[...group((entry) => entry.table)].flatMap(([table, entries]) =>
      entries.length < 2
        ? []
        : [
          `[duplicate-state-declaration] physical table ${table} is declared ${entries.length} times, at ${entries.map(site).sort().join(' and ')}; one table has one declaration and one owner`,
        ],
    ),
    ...[...group(site)].flatMap(([identity, entries]) =>
      entries.length < 2
        ? []
        : [
          `[duplicate-state-declaration] schema export ${identity} is declared ${entries.length} times, for ${entries.map((entry) => entry.table).sort().join(' and ')}; one export identity names one table`,
        ],
    ),
  ].sort()
}
