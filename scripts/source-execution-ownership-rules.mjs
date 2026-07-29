import fs from 'node:fs'
import path from 'node:path'
import { parseSync } from 'oxc-parser'

import { isMaintainedTestPath } from './architecture-policy-rules.mjs'
import { listMaintainedCodeFiles, toRepositoryPath } from './architecture-source-graph.mjs'

/**
 * Source-execution write ownership, read from the parser's tree (issue #491).
 *
 * `foreign-owner-table-access` models module imports, which is what it says it
 * models: raw SQL naming a table is not an import, so the module graph cannot see
 * it. Connectors used to ask the source-execution admission question three ways —
 * an imported table, a `sql` predicate in the retry claim, and another in retry
 * selection — and only the first was visible to that check. This proof closes the
 * other two and pins the owner call sites, so the boundary holds however it is
 * crossed.
 *
 * Everything here is decided on the AST. A physical table name appearing in a
 * comment is not a query, and an owner operation named in a comment or a string is
 * not a call, so neither can satisfy or violate this proof by text alone.
 */

export const RULE = 'source-execution-write-ownership'
export const CONNECTORS_ROOT = 'src/modules/connectors/'

/** The owner's tables, by physical name and by the export that hands each one out. */
const OWNER_TABLES = new Map([
  ['source_execution_scopes', 'sourceExecutionScopes'],
  ['source_execution_sessions', 'sourceExecutionSessions'],
])

/** The module publishing the owner operations connectors is allowed to call. */
export const OWNER_MODULE = 'source-execution/source-execution.persistence'

/**
 * The source-execution reads connectors keeps. Neither is a mutation and neither
 * answers the admission question: the schema file declares a foreign-key target, and
 * the schedule repository joins scope columns to rank eligible schedules. Recorded
 * exactly, so a new access cannot arrive unnoticed and a retired one cannot linger.
 */
export const RETAINED_TABLE_READS = new Map([
  ['src/modules/connectors/adapters/persistence/connector-schedule.repository.ts', ['sourceExecutionScopes']],
  ['src/modules/connectors/adapters/persistence/connector.schema.ts', ['sourceExecutionScopes']],
])

/**
 * Every owner operation each connectors file must call, and how many times.
 *
 * The count is load-bearing for `admitSourceExecutionScope`. A run request admits
 * the scope twice: once before it decides to run, and once after it has tentatively
 * claimed retry work, because this transaction's own writes land in between. One
 * call is the regression the second admission exists to prevent, so one call fails.
 */
export const REQUIRED_OWNER_CALLS = new Map([
  ['src/modules/connectors/adapters/persistence/connector-instance.persistence.ts',
    new Map([['ensureSourceExecutionScope', 1]])],
  ['src/modules/connectors/adapters/persistence/connector-instance.repository.ts',
    new Map([['ensureSourceExecutionScope', 1]])],
  ['src/modules/connectors/adapters/persistence/connector-retirement.persistence.ts',
    new Map([['retireSourceExecutionScope', 1]])],
  ['src/modules/connectors/adapters/persistence/connector-run-request.repository.ts',
    new Map([['admitSourceExecutionScope', 2]])],
])

/**
 * @param {unknown} node
 * @param {(node: Record<string, any>) => void} visit
 * @returns {void}
 */
function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (!node || typeof node !== 'object') return
  const record = /** @type {Record<string, any>} */ (node)
  if (typeof record.type === 'string') visit(record)
  for (const key of Object.keys(record)) {
    if (key !== 'type') walk(record[key], visit)
  }
}

/**
 * @typedef {object} FileFacts
 * @property {string[]} literals Every string and template chunk the file evaluates.
 * @property {Map<string, string>} tableBindings Imported table export -> specifier.
 * @property {string[]} tableMembers Owner table names reached as a member.
 * @property {Map<string, number>} ownerCalls Owner operation -> times it is called.
 */

/**
 * @param {string} filePath
 * @param {string} source
 * @returns {FileFacts}
 */
export function readFileFacts(filePath, source) {
  const parsed = parseSync(filePath, source)
  /** @type {string[]} */
  const literals = []
  /** @type {Map<string, string>} */
  const tableBindings = new Map()
  /** @type {string[]} */
  const tableMembers = []
  /** @type {Map<string, string>} Local binding -> owner operation it imports. */
  const ownerLocals = new Map()
  /** @type {Map<string, number>} */
  const calledLocals = new Map()
  const tableExports = new Set(OWNER_TABLES.values())

  for (const node of parsed.program.body) {
    if (node.type !== 'ImportDeclaration') continue
    const specifier = node.source.value
    for (const entry of node.specifiers ?? []) {
      const imported = entry.imported?.name ?? entry.imported?.value ?? null
      if (imported !== null && tableExports.has(imported)) {
        tableBindings.set(imported, specifier)
      }
      // A namespace import hands out every export, so its members are read below.
      if (imported !== null && specifier.endsWith(OWNER_MODULE)) {
        ownerLocals.set(entry.local?.name ?? '', imported)
      }
    }
  }

  walk(parsed.program, (node) => {
    if (node.type === 'Literal' && typeof node.value === 'string') literals.push(node.value)
    if (node.type === 'TemplateElement') literals.push(node.value?.cooked ?? node.value?.raw ?? '')
    if (node.type === 'MemberExpression' && !node.computed) {
      const name = node.property?.name
      if (typeof name === 'string' && tableExports.has(name)) tableMembers.push(name)
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier') {
      const name = node.callee.name
      calledLocals.set(name, (calledLocals.get(name) ?? 0) + 1)
    }
  })

  /** @type {Map<string, number>} */
  const ownerCalls = new Map()
  for (const [local, operation] of ownerLocals) {
    ownerCalls.set(operation, (ownerCalls.get(operation) ?? 0) + (calledLocals.get(local) ?? 0))
  }
  return { literals, ownerCalls, tableBindings, tableMembers }
}

/**
 * @param {string} repositoryPath
 * @param {FileFacts} facts
 * @returns {string[]}
 */
function findFileViolations(repositoryPath, facts) {
  const retained = RETAINED_TABLE_READS.get(repositoryPath) ?? []
  /** @type {string[]} */
  const violations = []

  for (const [table, tableExport] of OWNER_TABLES) {
    if (facts.literals.some((literal) => literal.includes(table))) {
      violations.push(
        `[${RULE}] ${repositoryPath} names ${table} in a query it evaluates; connectors asks source-execution through an owner operation, not through SQL the module graph cannot read`,
      )
    }
    const reached = facts.tableBindings.has(tableExport) || facts.tableMembers.includes(tableExport)
    if (reached && !retained.includes(tableExport)) {
      violations.push(
        `[${RULE}] ${repositoryPath} reaches ${tableExport}, owned by source-execution; connectors holds no source-execution table`,
      )
    }
  }

  for (const tableExport of retained) {
    if (!facts.tableBindings.has(tableExport)) {
      violations.push(
        `[${RULE}] ${repositoryPath} no longer reaches ${tableExport}; drop the retained read rather than leaving an allowance nothing supports`,
      )
    }
  }

  for (const [operation, required] of REQUIRED_OWNER_CALLS.get(repositoryPath) ?? []) {
    const called = facts.ownerCalls.get(operation) ?? 0
    if (called < required) {
      violations.push(
        `[${RULE}] ${repositoryPath} calls ${operation} from ${OWNER_MODULE} ${called} time(s), not the ${required} its contract needs; naming it in a comment or a string is not a call`,
      )
    }
  }
  return violations
}

/**
 * @param {string} root
 * @returns {{ scanned: number, violations: string[] }}
 */
export function findSourceExecutionOwnershipViolations(root) {
  /** @type {string[]} */
  const violations = []
  let scanned = 0

  for (const filePath of listMaintainedCodeFiles(root)) {
    const repositoryPath = toRepositoryPath(root, filePath)
    if (!repositoryPath.startsWith(CONNECTORS_ROOT)) continue
    if (isMaintainedTestPath(repositoryPath)) continue
    scanned += 1
    violations.push(...findFileViolations(
      repositoryPath,
      readFileFacts(filePath, fs.readFileSync(filePath, 'utf8')),
    ))
  }

  for (const repositoryPath of [...RETAINED_TABLE_READS.keys(), ...REQUIRED_OWNER_CALLS.keys()]) {
    if (!fs.existsSync(path.join(root, repositoryPath))) {
      violations.push(
        `[${RULE}] ${repositoryPath} is recorded here but is not a file; this proof names exact paths`,
      )
    }
  }
  return { scanned, violations: [...new Set(violations)].sort() }
}
