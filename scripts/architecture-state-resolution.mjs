import fs from 'node:fs'

import {
  listMaintainedCodeFiles,
  moduleOfPath,
  readModuleRecord,
  resolveSpecifier,
  toRepositoryPath,
  zoneOfPath,
} from './architecture-source-graph.mjs'

/**
 * A resolved export: the physical tables an exported name hands out, plus the
 * members a further static member access or destructure can reach.
 *
 * @typedef {object} StateRef
 * @property {'aggregate' | 'table'} kind
 * @property {Map<string, StateRef>} members
 * @property {string[]} tables
 * @property {boolean} unknownMembers
 */

/**
 * @typedef {object} ScannedFile
 * @property {string} path
 * @property {string | null} module
 * @property {string} zone
 * @property {import('./architecture-source-graph.mjs').ModuleRecord} record
 * @property {Map<string, string>} targets Specifier -> repository path.
 */

/**
 * @typedef {object} SourceScan
 * @property {Map<string, ScannedFile>} files
 * @property {string[]} failures
 */

/**
 * Reads every maintained file under `src` once.
 *
 * @param {string} root
 * @returns {SourceScan}
 */
export function scanMaintainedSource(root) {
  /** @type {Map<string, ScannedFile>} */
  const files = new Map()
  /** @type {string[]} */
  const failures = []

  for (const filePath of listMaintainedCodeFiles(root)) {
    const repositoryPath = toRepositoryPath(root, filePath)
    const record = readModuleRecord(fs.readFileSync(filePath, 'utf8'), repositoryPath)
    if (record.failure !== null) {
      failures.push(
        `[unlexable-module-source] ${repositoryPath} could not be read whole (${record.failure}); the check refuses to read a file partially`,
      )
      continue
    }

    /** @type {Map<string, string>} */
    const targets = new Map()
    for (const specifier of new Set(record.specifiers)) {
      const target = resolveSpecifier(root, filePath, specifier)
      if (target !== null) targets.set(specifier, target)
    }
    files.set(repositoryPath, {
      module: moduleOfPath(repositoryPath),
      path: repositoryPath,
      record,
      targets,
      zone: zoneOfPath(repositoryPath),
    })
  }
  return { failures, files }
}

/**
 * @param {StateRef | null} ref
 * @returns {string}
 */
function refKey(ref) {
  if (!ref) return ''
  const members = [...ref.members].map(([name, member]) => `${name}=${refKey(member)}`).sort()
  return `${ref.kind}:${ref.tables.join(',')}:${ref.unknownMembers}:[${members.join('|')}]`
}

/** @returns {StateRef} */
function tableRef(table) {
  return { kind: 'table', members: new Map(), tables: [table], unknownMembers: false }
}

/**
 * @param {Map<string, StateRef>} members
 * @param {string[]} looseTables Tables present without a readable member name.
 * @param {boolean} unknownMembers
 * @returns {StateRef | null}
 */
function aggregateRef(members, looseTables, unknownMembers) {
  const tables = [...new Set([
    ...looseTables,
    ...[...members.values()].flatMap((member) => member.tables),
  ])].sort()
  return tables.length > 0 ? { kind: 'aggregate', members, tables, unknownMembers } : null
}

/**
 * Resolves, for every scanned module, which exported names the ES module system
 * can hand to another module and which physical tables each one is.
 *
 * Attribution is by physical table identity, so renaming an export cannot escape
 * it. Aliases, destructuring, static member access, spreads, nested plain-object
 * aggregates, and re-export barrels of any depth are followed to a fixpoint. A
 * binding produced at runtime is not a table export and resolves to nothing;
 * #326 checks declarations, module edges, and foreign table imports, not runtime
 * value flow.
 *
 * @param {SourceScan} scan
 * @returns {Map<string, Map<string, StateRef>>}
 */
export function resolveStateExports(scan) {
  /** @type {Map<string, Map<string, StateRef>>} */
  const exportsByModule = new Map()
  for (const path of scan.files.keys()) exportsByModule.set(path, new Map())

  /**
   * @param {ScannedFile} file
   * @param {string} local
   * @param {Set<string>} visiting
   * @returns {StateRef | null}
   */
  const bindingRef = (file, local, visiting) => {
    if (visiting.has(local)) return null
    visiting.add(local)
    try {
      const value = file.record.syntax.values[local]
      if (value) {
        const resolved = valueRef(file, value, visiting)
        if (resolved) return resolved
      }
      for (const statement of file.record.syntax.staticImports) {
        const entry = statement.entries.find((candidate) => candidate.local === local)
        if (!entry) continue
        const target = file.targets.get(statement.specifier)
        const targetExports = target ? exportsByModule.get(target) : undefined
        if (!targetExports) return null
        if (entry.imported === 'name') return targetExports.get(entry.name) ?? null
        if (entry.imported === 'namespace') return aggregateRef(new Map(targetExports), [], false)
        return null
      }
      return null
    } finally {
      visiting.delete(local)
    }
  }

  /**
   * @param {ScannedFile} file
   * @param {import('./architecture-value-syntax.mjs').ValueNode} value
   * @param {Set<string>} visiting
   * @returns {StateRef | null}
   */
  const valueRef = (file, value, visiting) => {
    if (value.t === 'table') return tableRef(value.table ?? '')
    if (value.t === 'ident') return bindingRef(file, value.name ?? '', visiting)
    if (value.t === 'member') {
      const object = valueRef(file, value.object ?? { t: 'unresolved' }, visiting)
      if (!object || value.property === null) return null
      return object.members.get(value.property) ?? null
    }
    if (value.t !== 'object') return null

    /** @type {Map<string, StateRef>} */
    const members = new Map()
    /** @type {string[]} */
    const loose = []
    let unknownMembers = false
    for (const property of value.props ?? []) {
      const resolved = valueRef(file, property.value, visiting)
      if (!resolved) continue
      if (property.spread) {
        for (const [name, member] of resolved.members) members.set(name, member)
        if (resolved.members.size === 0) loose.push(...resolved.tables)
        unknownMembers = unknownMembers || resolved.unknownMembers
        continue
      }
      if (property.name === null) {
        loose.push(...resolved.tables)
        unknownMembers = true
        continue
      }
      members.set(property.name, resolved)
    }
    return aggregateRef(members, loose, unknownMembers)
  }

  /**
   * @param {ScannedFile} file
   * @returns {Map<string, StateRef>}
   */
  const computeExports = (file) => {
    /** @type {Map<string, StateRef>} */
    const result = new Map()

    for (const { exported, local } of file.record.syntax.localExports) {
      const ref = bindingRef(file, local, new Set())
      if (ref) result.set(exported, ref)
    }
    for (const reexport of file.record.syntax.reexports) {
      const target = file.targets.get(reexport.specifier)
      const targetExports = target ? exportsByModule.get(target) : undefined
      if (!targetExports) continue

      if (reexport.imported === 'all' && reexport.exported === null) {
        for (const [name, ref] of targetExports) result.set(name, ref)
        continue
      }
      if (reexport.imported === 'all' && reexport.exported) {
        const ref = aggregateRef(new Map(targetExports), [], false)
        if (ref) result.set(reexport.exported, ref)
        continue
      }
      const ref = targetExports.get(reexport.name)
      if (ref && reexport.exported) result.set(reexport.exported, ref)
    }
    return result
  }

  for (let changed = true; changed;) {
    changed = false
    for (const file of scan.files.values()) {
      const next = computeExports(file)
      const previous = exportsByModule.get(file.path)
      const differs = !previous
        || previous.size !== next.size
        || [...next].some(([name, ref]) => refKey(previous.get(name)) !== refKey(ref))
      if (differs) {
        exportsByModule.set(file.path, next)
        changed = true
      }
    }
  }
  return exportsByModule
}

/**
 * @typedef {object} StateReach
 * @property {'named' | 'opaque'} form
 * @property {string} kind Import form, for the opaque message.
 * @property {string[]} tables
 * @property {string} target
 */

/**
 * Every reach a file makes into a state-providing module.
 *
 * A named static import or re-export is attributed to the exact tables the target
 * hands out under that name, including every statically listed member of a plain
 * object aggregate. Namespace, star, default, bare, and dynamic access cannot be
 * attributed and is refused.
 *
 * @param {ScannedFile} file
 * @param {Map<string, Map<string, StateRef>>} exportsByModule
 * @returns {StateReach[]}
 */
export function stateReaches(file, exportsByModule) {
  /** @type {StateReach[]} */
  const reaches = []
  const stateOf = (specifier) => {
    const target = file.targets.get(specifier)
    const exported = target ? exportsByModule.get(target) : undefined
    return exported && exported.size > 0 ? { exported, target } : null
  }
  const named = (ref, target) => {
    if (ref) reaches.push({ form: 'named', kind: 'named', tables: ref.tables, target })
  }

  for (const statement of file.record.syntax.staticImports) {
    const state = stateOf(statement.specifier)
    if (!state) continue
    if (statement.kind !== 'named') {
      reaches.push({ form: 'opaque', kind: statement.kind, tables: [], target: state.target })
      continue
    }
    for (const entry of statement.entries) {
      if (entry.name === 'default') {
        reaches.push({ form: 'opaque', kind: 'default', tables: [], target: state.target })
        continue
      }
      named(state.exported.get(entry.name), state.target)
    }
  }

  for (const reexport of file.record.syntax.reexports) {
    const state = stateOf(reexport.specifier)
    if (!state) continue
    if (reexport.imported === 'all' || reexport.name === 'default') {
      reaches.push({
        form: 'opaque',
        kind: reexport.imported === 'all' ? 'star' : 'default',
        tables: [],
        target: state.target,
      })
      continue
    }
    named(state.exported.get(reexport.name), state.target)
  }

  for (const specifier of file.record.syntax.dynamicSpecifiers) {
    const state = stateOf(specifier)
    if (state) {
      reaches.push({ form: 'opaque', kind: 'dynamic', tables: [], target: state.target })
    }
  }
  return reaches
}

/**
 * @typedef {object} TableDeclaration
 * @property {string} schemaExport
 * @property {string} schemaModule
 * @property {string} table
 */

/**
 * Every canonical table declaration in the tree, as a list.
 *
 * A list rather than a map, so a physical name or an export identity declared
 * twice stays visible instead of overwriting its predecessor.
 *
 * @param {SourceScan} scan
 * @returns {TableDeclaration[]}
 */
export function declaredTables(scan) {
  return [...scan.files.values()].flatMap((file) =>
    file.record.syntax.tableCalls.flatMap((call) =>
      call.bound && call.exported && call.name
        ? [{ schemaExport: call.name, schemaModule: file.path, table: call.table }]
        : [],
    ),
  ).sort((a, b) => `${a.table}|${a.schemaModule}`.localeCompare(`${b.table}|${b.schemaModule}`))
}

/**
 * Constructor calls that are not a canonical declaration: unbound, bound to a
 * pattern, or never statically exported.
 *
 * @param {SourceScan} scan
 * @returns {string[]}
 */
export function misplacedTableCalls(scan) {
  return [...scan.files.values()].flatMap((file) =>
    file.record.syntax.tableCalls.flatMap((call) =>
      call.bound && call.exported
        ? []
        : [
          `[opaque-table-declaration] ${file.path} calls the Drizzle table constructor for ${call.table} without binding it to a named export; a canonical declaration must be a named static export the ownership manifest covers`,
        ],
    ),
  ).sort()
}

/**
 * Every unsafe use of the Drizzle table constructor: a re-export, a stored or
 * wrapped reference, a computed, optional, or `call`/`apply`/`bind` invocation, or
 * a call whose physical name is not a literal.
 *
 * @param {SourceScan} scan
 * @returns {string[]}
 */
export function opaqueTableDeclarations(scan) {
  return [...scan.files.values()].flatMap((file) =>
    file.record.syntax.constructorMisuse.map((name) =>
      `[opaque-table-declaration] ${file.path} uses the Drizzle table constructor as ${name} rather than calling it directly with a literal table name; declare tables with a direct call so ownership can be recorded`,
    ),
  ).sort()
}
