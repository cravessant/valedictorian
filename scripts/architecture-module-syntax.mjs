import { parseSync } from 'oxc-parser'

import { readValueFacts } from './architecture-value-syntax.mjs'

/** Placeholder specifier emitted for a dynamic import whose target is not a literal. */
export const COMPUTED_SPECIFIER = '\0computed-module-specifier'

/**
 * @typedef {object} ImportEntry
 * @property {'default' | 'name' | 'namespace'} imported
 * @property {string} local
 * @property {string} name Imported export name; `default` or `*` for the other kinds.
 */

/**
 * @typedef {object} StaticImport
 * @property {ImportEntry[]} entries
 * @property {'bare' | 'default' | 'named' | 'namespace'} kind
 * @property {boolean} reexport
 * @property {string} specifier
 */

/**
 * @typedef {object} ReexportEntry
 * @property {string | null} exported Null for `export * from`.
 * @property {'all' | 'default' | 'name'} imported
 * @property {string} name
 * @property {string} specifier
 */

/**
 * @typedef {object} ModuleSyntax
 * @property {Record<string, import('./architecture-value-syntax.mjs').ValueNode>} values Top-level binding shapes.
 * @property {string[]} constructorMisuse Unsafe uses of the Drizzle table constructor.
 * @property {{ bound: boolean, exported: boolean, name: string | null, table: string }[]} tableCalls
 * @property {boolean} computedDynamicImport
 * @property {string[]} dynamicSpecifiers Literal dynamic import targets.
 * @property {boolean} defaultExport Whether the module exports a default binding.
 * @property {{ exported: string, local: string }[]} localExports
 * @property {string} normalised Module declarations only, ready for es-module-lexer.
 * @property {string | null} parseFailure
 * @property {ReexportEntry[]} reexports
 * @property {string[]} specifiers Every module request the parser saw, literals only.
 * @property {StaticImport[]} staticImports
 */

/**
 * @param {unknown} node
 * @param {(node: Record<string, unknown>) => void} visit
 * @returns {void}
 */
function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (!node || typeof node !== 'object') return
  const record = /** @type {Record<string, unknown>} */ (node)
  if (typeof record.type === 'string') visit(record)
  for (const key of Object.keys(record)) {
    if (key !== 'type') walk(record[key], visit)
  }
}

/**
 * Value-form text for each statement-level type-only re-export, keyed by its start.
 *
 * `es-module-lexer` deliberately reports nothing for `export type { A } from 'm'`
 * or `export type * from 'm'`, so emitting those statements verbatim would lose a
 * real dependency. Each one is rebuilt from the parser's own view as the equivalent
 * value form, with the specifier copied verbatim from the source so it is never
 * altered. Only statements the parser marked type-only are rebuilt; every other
 * declaration is emitted exactly as written.
 *
 * @param {Record<string, any>[]} body
 * @returns {Map<number, string>}
 */
function readTypeOnlyReexports(body) {
  /** @type {Map<number, string>} */
  const rebuilt = new Map()
  for (const node of body) {
    if (node.exportKind !== 'type' || !node.source?.raw) continue
    if (node.type === 'ExportAllDeclaration') {
      const alias = node.exported?.name ? ` as ${node.exported.name}` : ''
      rebuilt.set(node.start, `export *${alias} from ${node.source.raw}`)
      continue
    }
    if (node.type !== 'ExportNamedDeclaration') continue
    const clauses = (node.specifiers ?? []).map((specifier) => {
      const local = specifier.local?.name ?? ''
      const exported = specifier.exported?.name ?? local
      return local === exported ? local : `${local} as ${exported}`
    })
    rebuilt.set(node.start, `export { ${clauses.join(', ')} } from ${node.source.raw}`)
  }
  return rebuilt
}

/**
 * @param {Record<string, any>} entry
 * @returns {ImportEntry}
 */
function readImportEntry(entry) {
  const kind = entry.importName?.kind
  if (kind === 'NamespaceObject') {
    return { imported: 'namespace', local: entry.localName?.value ?? '', name: '*' }
  }
  if (kind === 'Default') {
    return { imported: 'default', local: entry.localName?.value ?? '', name: 'default' }
  }
  return {
    imported: 'name',
    local: entry.localName?.value ?? entry.importName?.name ?? '',
    name: entry.importName?.name ?? '',
  }
}

/**
 * @param {ImportEntry[]} entries
 * @returns {'bare' | 'default' | 'named' | 'namespace'}
 */
function classifyImport(entries) {
  if (entries.length === 0) return 'bare'
  if (entries.some((entry) => entry.imported === 'namespace')) return 'namespace'
  if (entries.some((entry) => entry.imported === 'default')) return 'default'
  return 'named'
}

/**
 * Reads a file's module syntax with a real TypeScript/TSX parser and rebuilds the
 * module declarations as standalone text.
 *
 * The rebuilt text is a verbatim concatenation of the source spans of the import
 * and re-export declarations, plus one synthesised call per dynamic import, so no
 * specifier is ever rewritten and no declaration is dropped. JSX, types, and every
 * other body construct are simply absent rather than transformed, which is what
 * makes the result lexable. A dynamic import whose argument is not a string
 * literal is emitted with a placeholder specifier that no path can produce, so the
 * caller can refuse it by name instead of losing it.
 *
 * A parse diagnostic yields `parseFailure` and no facts at all; the caller turns
 * that into a hard failure rather than reading the file partially.
 *
 * @param {string} source
 * @param {string} filePath
 * @returns {ModuleSyntax}
 */
export function readModuleSyntax(source, filePath) {
  /** @type {ModuleSyntax} */
  const empty = {
    computedDynamicImport: false,
    defaultExport: false,
    dynamicSpecifiers: [],
    localExports: [],
    normalised: '',
    constructorMisuse: [],
    parseFailure: null,
    tableCalls: [],
    reexports: [],
    specifiers: [],
    staticImports: [],
    values: {},
  }

  let parsed
  try {
    parsed = parseSync(filePath, source)
  } catch (error) {
    return { ...empty, parseFailure: /** @type {Error} */ (error).message }
  }
  if (parsed.errors.length > 0) {
    return { ...empty, parseFailure: parsed.errors.map((error) => error.message).join('; ') }
  }

  /** @type {string[]} */
  const declarations = []
  /** @type {string[]} */
  const specifiers = []
  const staticImports = parsed.module.staticImports.map((statement) => {
    declarations.push(source.slice(statement.start, statement.end))
    specifiers.push(statement.moduleRequest.value)
    const entries = statement.entries.map(readImportEntry)
    return {
      entries,
      kind: classifyImport(entries),
      reexport: false,
      specifier: statement.moduleRequest.value,
    }
  })

  const typeOnlyReexports = readTypeOnlyReexports(parsed.program.body)

  /** @type {ReexportEntry[]} */
  const reexports = []
  /** @type {{ exported: string, local: string }[]} */
  const localExports = []
  let defaultExport = false
  for (const statement of parsed.module.staticExports) {
    // One declaration and one module request per statement, however many clauses
    // it forwards, so the parsed inventory matches what the lexer reports.
    const forwarding = statement.entries.find((entry) => entry.moduleRequest !== null)
    if (forwarding?.moduleRequest) {
      const typeOnly = typeOnlyReexports.get(statement.start)
      declarations.push(typeOnly ?? source.slice(statement.start, statement.end))
      specifiers.push(forwarding.moduleRequest.value)
    }
    for (const entry of statement.entries) {
      const request = entry.moduleRequest
      defaultExport = defaultExport
        || entry.exportName.name === 'default'
        || entry.exportName.kind === 'Default'
      if (!request) {
        if (entry.exportName.name && entry.localName.name) {
          localExports.push({ exported: entry.exportName.name, local: entry.localName.name })
        }
        continue
      }
      reexports.push({
        exported: entry.exportName.name,
        // `export * from` reports AllButDefault, `export * as ns from` reports All.
        imported: entry.importName.kind === 'AllButDefault' || entry.importName.kind === 'All'
          ? 'all'
          : entry.importName.kind === 'Default' ? 'default' : 'name',
        name: entry.importName.name ?? '*',
        specifier: request.value,
      })
    }
  }

  /** @type {string[]} */
  const dynamicSpecifiers = []
  let computedDynamicImport = false
  walk(parsed.program.body, (node) => {
    if (node.type !== 'ImportExpression') return
    const specifier = /** @type {Record<string, any>} */ (node).source
    if (specifier?.type === 'Literal' && typeof specifier.value === 'string') {
      declarations.push(`import(${source.slice(specifier.start, specifier.end)})`)
      specifiers.push(specifier.value)
      dynamicSpecifiers.push(specifier.value)
      return
    }
    computedDynamicImport = true
    declarations.push(`import(${JSON.stringify(COMPUTED_SPECIFIER)})`)
  })

  const valueFacts = readValueFacts(parsed.program, staticImports, reexports, localExports)
  return {
    computedDynamicImport,
    constructorMisuse: valueFacts.constructorMisuse,
    defaultExport,
    dynamicSpecifiers,
    localExports,
    normalised: `${declarations.join('\n')}\n`,
    parseFailure: null,
    reexports,
    specifiers,
    staticImports,
    tableCalls: valueFacts.tableCalls,
    values: valueFacts.values,
  }
}
