import fs from 'node:fs'
import path from 'node:path'

import { moduleOfPath } from './architecture-source-graph.mjs'

export const MODULE_GRAPH_MANIFEST = 'architecture/module-graph.json'

/** Rules an exact transitional exception is allowed to relax. */
export const RELAXABLE_RULES = new Set(['foreign-owner-table-access'])

/**
 * Stable purposes. Each is a permanent architectural fact, not a relaxation, so an
 * entry carrying one names no retiring issue. Every purpose is bound to a
 * mechanical predicate on the entry, so a purpose cannot be claimed on a path it
 * does not describe.
 */
export const PERMISSION_PURPOSES = new Set([
  'cross-capability-state-access',
  'foreign-key-reference',
  'platform-ownership-root',
  'schema-composition',
  'schema-registration',
  'test-state-access',
])

/** The exact connectors mutations #491 promises to move behind source-execution. */
const connectorSourceExecutionWrites = new Set([
  'src/modules/connectors/connector-instance.persistence.ts|source_execution_scopes',
  'src/modules/connectors/connector-retirement.persistence.ts|source_execution_scopes',
  'src/modules/connectors/connector-retirement.persistence.ts|source_execution_sessions',
  'src/modules/connectors/connector.repository.ts|source_execution_scopes',
])

/**
 * What each retiring issue is allowed to claim. #326 records debt truthfully, so
 * an issue may only be named where its own contract reaches.
 */
const retirementScopes = {
  '#491': {
    // The four mutations #491's contract names. Nothing else may claim it.
    describe: 'one of the four connectors mutations of a source-execution table that #491 names',
    fits: (entry) => connectorSourceExecutionWrites.has(`${entry.source}|${entry.table}`),
  },
}

const stampPattern = /^#\d+$/
const globCharacterPattern = /[*?[\]{}!]/
const schemaFilePattern = /\.schema\.[cm]?[jt]s$/
const minimumReasonLength = 24

/**
 * A maintained test or test-support path. Used only to decide which entries may
 * claim a test purpose; nothing is ever excluded from the scan by it.
 */
const testPathPattern =
  /(?:^|\/)(?:test|test-fixtures)\/|\.(?:test|spec|fixture|test-helpers|test-harness)\.(?:[cm]?[jt]s|[jt]sx)$/

const exceptionKeys = new Set([
  'owner',
  'reason',
  'recordedIn',
  'retiredBy',
  'rule',
  'source',
  'table',
  'target',
])
const permissionKeys = new Set([
  'owner',
  'purpose',
  'reason',
  'recordedIn',
  'source',
  'table',
  'target',
])

/**
 * @param {string} repositoryPath
 * @returns {boolean}
 */
export function isMaintainedTestPath(repositoryPath) {
  return testPathPattern.test(repositoryPath)
}

/**
 * @param {Record<string, any>} manifest
 * @param {Record<string, string>} entry
 * @param {Map<string, { kind: string }>} owners
 * @returns {string | null} Why the purpose does not fit, or null when it does.
 */
function purposeMismatch(manifest, entry, owners) {
  const { purpose, source, table, target } = entry
  if (purpose === 'cross-capability-state-access') {
    if (!source.startsWith(`${manifest.moduleRoot}/`)) {
      return 'only a capability module reaches another capability across the boundary'
    }
    return moduleOfPath(source) === entry.owner
      ? `${source} is inside the owning module ${entry.owner}`
      : null
  }
  if (purpose === 'schema-composition') {
    return source === manifest.canonicalSchemaAggregate
      ? null
      : `only ${manifest.canonicalSchemaAggregate} composes the canonical schema`
  }
  if (purpose === 'schema-registration') {
    if (source !== manifest.schemaRegistrar) {
      return `only ${manifest.schemaRegistrar} registers the canonical schema`
    }
    return target === manifest.canonicalSchemaAggregate
      ? null
      : `registration reads ${manifest.canonicalSchemaAggregate}, not ${target}`
  }
  if (purpose === 'foreign-key-reference') {
    return schemaFilePattern.test(source)
      ? null
      : 'only a schema file declares a foreign-key column'
  }
  if (purpose === 'platform-ownership-root') {
    if (owners.get(entry.owner)?.kind !== 'platform') {
      return `${table} is owned by capability owner ${entry.owner}`
    }
    return source.startsWith(`${manifest.moduleRoot}/`)
      ? 'capability module source must not claim the platform ownership root'
      : null
  }
  return isMaintainedTestPath(source)
    ? null
    : 'a test purpose may only be claimed by a maintained test or test-support path'
}

/**
 * @param {string} root
 * @param {Record<string, any>} entry
 * @param {string} label
 * @param {Set<string>} allowedKeys
 * @param {string} rule
 * @returns {string[]}
 */
function findShapeViolations(root, entry, label, allowedKeys, rule) {
  const extraKeys = Object.keys(entry ?? {}).filter((key) => !allowedKeys.has(key))
  const missingKeys = [...allowedKeys].filter((key) => typeof entry?.[key] !== 'string')
  if (extraKeys.length > 0 || missingKeys.length > 0) {
    return [
      `[${rule}] ${MODULE_GRAPH_MANIFEST} entry ${label} must carry exactly ${[...allowedKeys].sort().join(', ')}`,
    ]
  }
  for (const key of ['source', 'target']) {
    const value = /** @type {string} */ (entry[key])
    if (globCharacterPattern.test(value)) {
      return [
        `[${rule}] ${MODULE_GRAPH_MANIFEST} entry ${label} uses a pattern for ${key}; only exact repository paths are accepted`,
      ]
    }
    const absolutePath = path.join(root, value)
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      return [
        `[${rule}] ${MODULE_GRAPH_MANIFEST} entry ${label} names ${key} ${value}, which is not an exact repository file`,
      ]
    }
  }
  if (entry.reason.length < minimumReasonLength) {
    return [`[${rule}] ${MODULE_GRAPH_MANIFEST} entry ${label} must explain itself`]
  }
  return []
}

/**
 * Shape, stamp, and truthfulness rules for the transitional exception set.
 *
 * An exception is a relaxation with an end date: it names the rule it relaxes and
 * an issue that will actually remove the access. The issue must be one the
 * manifest declares, so a made-up retirement claim is refused.
 *
 * @param {string} root
 * @param {Record<string, any>} manifest
 * @returns {string[]}
 */
export function findExceptionShapeViolations(root, manifest) {
  const stamps = new Set(Array.isArray(manifest.stamps) ? manifest.stamps : [])
  const retiring = new Set(Array.isArray(manifest.retiringIssues) ? manifest.retiringIssues : [])

  return (manifest.exceptions ?? []).flatMap((exception) => {
    const label = `${exception?.rule ?? '?'} ${exception?.source ?? '?'} -> ${exception?.target ?? '?'}`
    const shape = findShapeViolations(
      root,
      exception,
      label,
      exceptionKeys,
      'broadened-architecture-exception',
    )
    if (shape.length > 0) return shape

    if (!RELAXABLE_RULES.has(exception.rule)) {
      return [
        `[broadened-architecture-exception] ${MODULE_GRAPH_MANIFEST} exception ${label} names rule ${exception.rule}, which no rule in this check relaxes`,
      ]
    }
    if (!stamps.has(exception.recordedIn)) {
      return [
        `[unstamped-architecture-exception] ${MODULE_GRAPH_MANIFEST} exception ${label} is not stamped by a declared issue reference`,
      ]
    }
    if (!stampPattern.test(exception.retiredBy) || !retiring.has(exception.retiredBy)) {
      return [
        `[untruthful-retirement-claim] ${MODULE_GRAPH_MANIFEST} exception ${label} claims retirement by ${exception.retiredBy}, which is not a declared retiring issue`,
      ]
    }
    const scope = retirementScopes[exception.retiredBy]
    if (!scope || !scope.fits(exception, manifest)) {
      return [
        `[untruthful-retirement-claim] ${MODULE_GRAPH_MANIFEST} exception ${label} claims retirement by ${exception.retiredBy}, which only covers ${scope?.describe ?? 'nothing this check models'}`,
      ]
    }
    return []
  })
}

/**
 * Shape and purpose rules for the stable permission set.
 *
 * A permission is not a relaxation and carries no retiring issue: it records a
 * permanent architectural fact such as the canonical schema aggregate composing
 * owned tables. It is exact, stamped, and bound to a purpose whose predicate the
 * entry must satisfy, so a production path cannot claim a test purpose and no
 * entry can stand in for a class of accesses.
 *
 * @param {string} root
 * @param {Record<string, any>} manifest
 * @param {Map<string, { kind: string }>} owners
 * @returns {string[]}
 */
export function findPermissionShapeViolations(root, manifest, owners) {
  const stamps = new Set(Array.isArray(manifest.stamps) ? manifest.stamps : [])

  return (manifest.permissions ?? []).flatMap((permission) => {
    const label = `${permission?.purpose ?? '?'} ${permission?.source ?? '?'} -> ${permission?.target ?? '?'}`
    const shape = findShapeViolations(
      root,
      permission,
      label,
      permissionKeys,
      'broadened-architecture-permission',
    )
    if (shape.length > 0) return shape

    if (!PERMISSION_PURPOSES.has(permission.purpose)) {
      return [
        `[broadened-architecture-permission] ${MODULE_GRAPH_MANIFEST} permission ${label} names purpose ${permission.purpose}, which this check does not define`,
      ]
    }
    if (!stamps.has(permission.recordedIn)) {
      return [
        `[unstamped-architecture-permission] ${MODULE_GRAPH_MANIFEST} permission ${label} is not stamped by a declared issue reference`,
      ]
    }
    const mismatch = purposeMismatch(manifest, permission, owners)
    if (mismatch !== null) {
      return [
        `[misplaced-architecture-permission] ${MODULE_GRAPH_MANIFEST} permission ${label} claims purpose ${permission.purpose}, but ${mismatch}`,
      ]
    }
    return []
  })
}

/**
 * One exact access, one entry.
 *
 * `exceptions` and `permissions` are two categories of the same exact
 * source/target/table record, so a tuple may appear once in total. Keying them
 * separately let a transitional exception and a stable permission both claim an
 * access, and whichever was read last silently won. The key is global, the report
 * names every category that claimed the tuple, and both are sorted, so a
 * collision fails `architecture:check` deterministically.
 *
 * @param {Record<string, any>} manifest
 * @returns {string[]}
 */
export function findDuplicatePolicyEntries(manifest) {
  /** @type {Map<string, string[]>} */
  const claims = new Map()
  const record = (entry, category) => {
    if (typeof entry?.source !== 'string' || typeof entry?.target !== 'string') return
    if (typeof entry?.table !== 'string') return
    const key = `${entry.source}|${entry.target}|${entry.table}`
    claims.set(key, [...(claims.get(key) ?? []), category])
  }
  for (const entry of manifest.exceptions ?? []) record(entry, 'exception')
  for (const entry of manifest.permissions ?? []) record(entry, 'permission')

  return [...claims].flatMap(([key, categories]) => {
    if (categories.length < 2) return []
    const [source, target, table] = key.split('|')
    return [
      `[duplicate-architecture-policy-entry] ${MODULE_GRAPH_MANIFEST} records ${source} -> ${target} for ${table} ${categories.length} times, as ${[...categories].sort().join(' and ')}; one access has exactly one entry`,
    ]
  }).sort()
}

/**
 * @param {Record<string, any>} manifest
 * @returns {Map<string, Record<string, string>>}
 */
export function policyByAccess(manifest) {
  /** @type {Map<string, Record<string, string>>} */
  const entries = new Map()
  for (const entry of [...(manifest.exceptions ?? []), ...(manifest.permissions ?? [])]) {
    entries.set(`${entry.source}|${entry.target}|${entry.table}`, entry)
  }
  return entries
}
