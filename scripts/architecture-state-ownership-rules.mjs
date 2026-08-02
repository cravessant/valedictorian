import fs from 'node:fs'
import path from 'node:path'

import { PUBLIC_SURFACE_FILE } from './architecture-public-surface-rules.mjs'
import { readManifest } from './architecture-source-graph.mjs'
import { declaredTables, misplacedTableCalls } from './architecture-state-resolution.mjs'

export const STATE_OWNERSHIP_MANIFEST = 'architecture/state-ownership.json'

/** Where a capability-owned declaration must live, and where it must not (#328). */
export const CAPABILITY_DECLARATION_ROOT = 'packages/local-runtime/src/modules'
export const PLATFORM_DECLARATION_ROOT = 'packages/local-runtime/src/db'

const ownerNamePattern = /^[a-z][a-z0-9-]*$/
const ownerKinds = new Set(['capability', 'platform'])
const tableEntryKeys = new Set(['owner', 'schemaExport', 'schemaModule'])
const ownerEntryKeys = new Set(['declarationModule', 'kind', 'module'])

/**
 * @typedef {object} TableOwnership
 * @property {string} owner
 * @property {string} schemaExport
 * @property {string} schemaModule
 */

/**
 * @typedef {object} OwnerRecord
 * @property {string} kind
 * @property {string | null} module Capability root: public surface, edges, module name.
 * @property {string} [declarationModule] Only where declarations live outside `module`.
 */

/**
 * @typedef {object} StateOwnershipManifest
 * @property {Record<string, OwnerRecord>} owners
 * @property {string[]} schemaModules
 * @property {Record<string, TableOwnership>} tables
 */

/**
 * The one directory a capability owner declares its tables in.
 *
 * Almost always the capability root. `declarationModule` exists for the case where
 * the runtime and public root cannot move — the module name is load-bearing in
 * edges, in `public.ts`, and in the cross-capability purpose predicate — while the
 * schema file sits in a sibling declaration-only directory.
 *
 * @param {OwnerRecord} entry
 * @returns {string | null}
 */
export function declarationRoot(entry) {
  return entry.declarationModule ?? entry.module
}

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
 * Whether a declaration root is a single module directory directly under the module
 * root, so it can name one capability and nothing wider.
 *
 * @param {string} root
 * @param {string} candidate
 * @returns {boolean}
 */
function isModuleDirectory(root, candidate) {
  const segments = candidate.split('/')
  const capabilitySegments = CAPABILITY_DECLARATION_ROOT.split('/')
  if (
    segments.length !== capabilitySegments.length + 1
    || segments.slice(0, capabilitySegments.length).join('/') !== CAPABILITY_DECLARATION_ROOT
  ) {
    return false
  }
  const absolutePath = path.join(root, candidate)
  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()
}

/**
 * Shape rules for both roots an owner can name.
 *
 * `module` is the capability root and is pinned to `packages/local-runtime/src/modules/<owner>`. That is not
 * a new convention: the rest of the check already reads exactly this identity, since
 * `observedStateAccess` and the cross-capability purpose predicate both compare an
 * owner's name against the module directory a path belongs to. Leaving the field free
 * to name any existing path let it be widened to the whole module root, after which
 * every declaration anywhere under `packages/local-runtime/src/modules` counted as being at home.
 *
 * `declarationModule` is the only way a declaration root can differ from the
 * capability root, and it is deliberately hard to abuse. It exists on capability
 * owners only, it has to name a real module directory, it may not repeat the
 * capability root it is there to override, and no two owners may claim the same
 * declaration root. It may not name another declared owner's capability root, nor any
 * directory that publishes its own `public.ts` — a directory with a public contract is
 * somebody's module, not a place to park another capability's tables. What is left is
 * a declaration-only sibling, which is the only thing this field is for.
 *
 * @param {string} root
 * @param {Map<string, OwnerRecord>} owners
 * @returns {string[]}
 */
function findOwnerRootViolations(root, owners) {
  const capabilityRoots = new Map(
    [...owners].flatMap(([owner, entry]) => (entry.kind === 'capability' && entry.module
      ? [[entry.module, owner]]
      : [])),
  )
  /** @type {Map<string, string>} */
  const claimed = new Map()

  return [...owners].flatMap(([owner, entry]) => {
    const override = entry.declarationModule
    if (entry.kind !== 'capability') {
      return [
        ...(entry.module === null ? [] : [
          `[misowned-state-location] ${STATE_OWNERSHIP_MANIFEST} gives ${entry.kind} owner ${owner} module ${entry.module}; the platform ownership root has no capability module`,
        ]),
        ...(override === undefined ? [] : [
          `[misowned-state-location] ${STATE_OWNERSHIP_MANIFEST} gives ${entry.kind} owner ${owner} a declarationModule; only a capability declares state inside ${CAPABILITY_DECLARATION_ROOT}`,
        ]),
      ]
    }

    const canonical = `${CAPABILITY_DECLARATION_ROOT}/${owner}`
    if (entry.module !== canonical) {
      return [
        `[misowned-state-location] ${STATE_OWNERSHIP_MANIFEST} gives capability owner ${owner} module ${entry.module}, not its canonical module ${canonical}; a capability module is exactly ${CAPABILITY_DECLARATION_ROOT}/<owner>, the identity the module graph and the cross-capability rules already read`,
      ]
    }
    if (!isModuleDirectory(root, entry.module)) {
      return [
        `[misowned-state-location] ${STATE_OWNERSHIP_MANIFEST} gives capability owner ${owner} module ${entry.module}, which is not an existing module directory`,
      ]
    }
    const declarationModule = declarationRoot(entry)
    if (declarationModule === null) return []

    if (override !== undefined && !isModuleDirectory(root, override)) {
      return [
        `[misowned-state-location] ${STATE_OWNERSHIP_MANIFEST} gives owner ${owner} declaration root ${override}, which is not a module directory directly under ${CAPABILITY_DECLARATION_ROOT}`,
      ]
    }
    if (override === entry.module) {
      return [
        `[misowned-state-location] ${STATE_OWNERSHIP_MANIFEST} gives owner ${owner} declaration root ${override}, which is already its module; drop the redundant declarationModule`,
      ]
    }
    const sibling = capabilityRoots.get(declarationModule)
    if (sibling !== undefined && sibling !== owner) {
      return [
        `[misowned-state-location] ${STATE_OWNERSHIP_MANIFEST} gives owner ${owner} declaration root ${declarationModule}, which is capability ${sibling}'s module; one capability never declares its state in another's module`,
      ]
    }
    if (override !== undefined && fs.existsSync(path.join(root, override, PUBLIC_SURFACE_FILE))) {
      return [
        `[misowned-state-location] ${STATE_OWNERSHIP_MANIFEST} gives owner ${owner} declaration root ${override}, which publishes its own ${PUBLIC_SURFACE_FILE}; a declaration root is a declaration-only directory, not another module`,
      ]
    }
    const previous = claimed.get(declarationModule)
    claimed.set(declarationModule, owner)
    return previous === undefined
      ? []
      : [
        `[misowned-state-location] ${STATE_OWNERSHIP_MANIFEST} gives owners ${[previous, owner].sort().join(' and ')} the same declaration root ${declarationModule}; one declaration root has one owner`,
      ]
  })
}

/**
 * Where a declaration is allowed to live, given who owns it (#328).
 *
 * The rest of this check compares the manifest against the tree, so a table moved
 * somewhere else with its `schemaModule` edited to match reads as consistent and
 * passes. This rule is keyed on the owner instead of on agreement: a capability-owned
 * table is declared in that owner's own declaration root, and the platform ownership
 * root is declared outside `packages/local-runtime/src/modules` entirely. Both legs read the live
 * declaration, so editing `schemaModule` cannot launder a move — and because the
 * root is per-owner rather than the whole module tree, neither can leaving a
 * re-export behind in the owning module while the definition sits in a sibling.
 *
 * That only holds while the roots themselves are pinned, which is what
 * `findOwnerRootViolations` is for: a root free to name any existing path can simply
 * be widened to `packages/local-runtime/src/modules`, and every location below it passes.
 *
 * The remaining escape would be to relabel the owner: call `connectors` platform and
 * the capability leg no longer applies. So an owner whose name is a real module
 * directory must be declared `capability`, which pins every module's kind to the
 * tree rather than to the manifest's own claim.
 *
 * @param {string} root
 * @param {StateOwnershipManifest} manifest
 * @param {import('./architecture-state-resolution.mjs').TableDeclaration[]} declared
 * @returns {string[]}
 */
function findOwnerLocationViolations(root, manifest, declared) {
  const owners = new Map(Object.entries(manifest.owners ?? {}))

  return [
    ...findOwnerRootViolations(root, owners),
    ...[...owners].flatMap(([owner, entry]) =>
      entry.kind === 'capability'
        || !fs.existsSync(path.join(root, CAPABILITY_DECLARATION_ROOT, owner))
        ? []
        : [
          `[misowned-state-location] ${STATE_OWNERSHIP_MANIFEST} declares owner ${owner} as ${entry.kind} while ${CAPABILITY_DECLARATION_ROOT}/${owner} is a capability module; a module cannot relabel itself platform to declare state outside ${CAPABILITY_DECLARATION_ROOT}`,
        ],
    ),
    ...declared.flatMap((entry) => {
      const owner = manifest.tables?.[entry.table]?.owner
      const record = owner === undefined ? undefined : owners.get(owner)
      if (record === undefined) return []
      if (record.kind === 'platform') {
        return entry.schemaModule.startsWith(`${CAPABILITY_DECLARATION_ROOT}/`)
          ? [
            `[misowned-state-location] ${entry.schemaModule} declares ${entry.table}, owned by platform ${owner}, inside ${CAPABILITY_DECLARATION_ROOT}; the platform ownership root is not declared in a capability module`,
          ]
          : []
      }
      const home = declarationRoot(record)
      return home !== null && entry.schemaModule.startsWith(`${home}/`)
        ? []
        : [
          `[misowned-state-location] ${entry.schemaModule} declares ${entry.table}, owned by capability ${owner}, outside its declaration root ${home}; a capability-owned table is declared in its own module, not under ${PLATFORM_DECLARATION_ROOT} and not in another module`,
        ]
    }),
  ].sort()
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
    ...findOwnerLocationViolations(root, manifest, declared),
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
