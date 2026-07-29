/**
 * Static declaration and export-shape analysis for the architecture check.
 *
 * Two questions are answered here, both from the parser's tree rather than from
 * text: which local bindings are the Drizzle `pgTable` constructor, and which
 * top-level bindings are table exports the ES module system can hand to another
 * module by name.
 *
 * This is deliberately not a value-flow analysis. #326 enforces table
 * declarations, the module graph, and foreign table imports; a value produced at
 * runtime — by a call, a function, a class, a container, or a mutation — is simply
 * not a table export, so it is not modelled.
 */

const PG_CORE_SPECIFIER = 'drizzle-orm/pg-core'
const PG_TABLE_EXPORT = 'pgTable'

/**
 * @typedef {object} ValueNode
 * @property {'ident' | 'member' | 'object' | 'table' | 'unresolved'} t
 * @property {string} [name] Identifier name, for `ident`.
 * @property {ValueNode} [object] Receiver, for `member`.
 * @property {string | null} [property] Member name, or null when it cannot be read.
 * @property {{ name: string | null, spread: boolean, value: ValueNode }[]} [props] For `object`.
 * @property {string} [table] Physical table name, for `table`.
 */

/**
 * @typedef {object} TableCall
 * @property {boolean} bound True when the call initialises a named binding.
 * @property {boolean} exported True when that binding is statically exported.
 * @property {string | null} name The exported identifier, when there is one.
 * @property {string} table The literal physical table name.
 */

/**
 * @typedef {object} ValueFacts
 * @property {Record<string, ValueNode>} values Top-level binding name -> shape.
 * @property {string[]} constructorMisuse Labels for unsafe `pgTable` constructor use.
 * @property {TableCall[]} tableCalls Every exact constructor call, in source order.
 */

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
 * @param {Record<string, any>} node
 * @returns {string | null}
 */
function staticPropertyName(node) {
  if (!node.computed) return node.property?.name ?? null
  return node.property?.type === 'Literal' && typeof node.property.value === 'string'
    ? node.property.value
    : null
}

/**
 * @param {Record<string, any>} property
 * @returns {string | null}
 */
function staticKeyName(property) {
  if (!property.computed) {
    if (property.key?.type === 'Identifier') return property.key.name
    return property.key?.type === 'Literal' ? String(property.key.value) : null
  }
  return property.key?.type === 'Literal' && typeof property.key.value === 'string'
    ? property.key.value
    : null
}

/**
 * @param {Record<string, any>} node
 * @returns {Record<string, any>}
 */
function unwrap(node) {
  let current = node
  while (
    current
    && (current.type === 'TSAsExpression'
      || current.type === 'TSSatisfiesExpression'
      || current.type === 'TSNonNullExpression'
      || current.type === 'ParenthesizedExpression'
      || current.type === 'ChainExpression')
  ) {
    current = current.expression
  }
  return current
}

/**
 * @param {Record<string, any>} node
 * @param {Set<string>} constructors
 * @param {Set<string>} namespaces
 * @returns {boolean}
 */
function isConstructorExpression(node, constructors, namespaces) {
  if (!node) return false
  if (node.type === 'Identifier') return constructors.has(node.name)
  if (node.type !== 'MemberExpression' || node.optional) return false
  if (node.object?.type !== 'Identifier' || !namespaces.has(node.object.name)) return false
  return staticPropertyName(node) === PG_TABLE_EXPORT
}

/**
 * Local names a destructuring pattern binds to the `pgTable` member, following
 * nested patterns.
 *
 * @param {Record<string, any>} pattern
 * @param {boolean} fromNamespace
 * @returns {string[]}
 */
function destructuredConstructorNames(pattern, fromNamespace) {
  if (!fromNamespace || pattern?.type !== 'ObjectPattern') return []
  return (pattern.properties ?? []).flatMap((property) => {
    if (property.type !== 'Property') return []
    const value = unwrap(property.value)
    // Descend through any nesting; only a `pgTable` key binds the constructor.
    if (value?.type === 'ObjectPattern') return destructuredConstructorNames(value, true)
    if (staticKeyName(property) !== PG_TABLE_EXPORT) return []
    if (value?.type === 'Identifier') return [value.name]
    if (value?.type === 'AssignmentPattern') {
      const target = unwrap(value.left)
      return target?.type === 'Identifier' ? [target.name] : []
    }
    return []
  })
}

/**
 * Local names bound to the `pgTable` constructor.
 *
 * Seeded only from `drizzle-orm/pg-core`, so a local helper that happens to share
 * the name is never mistaken for it. Direct aliases, namespace members, and
 * destructuring are followed to a fixpoint, in declarations and in later
 * assignments alike, so `const { pgTable: define } = pg` and
 * `let define; ({ pgTable: define } = pg)` bind the same identity. Nothing else
 * is followed; every other shape is refused as misuse.
 *
 * @param {Record<string, any>} program
 * @param {{ entries: { imported: string, local: string, name: string }[], specifier: string }[]} staticImports
 * @returns {{ constructors: Set<string>, namespaces: Set<string> }}
 */
export function readTableConstructors(program, staticImports) {
  /** @type {Set<string>} */
  const constructors = new Set()
  /** @type {Set<string>} */
  const namespaces = new Set()
  for (const statement of staticImports) {
    if (statement.specifier !== PG_CORE_SPECIFIER) continue
    for (const entry of statement.entries) {
      if (entry.imported === 'namespace') namespaces.add(entry.local)
      if (entry.imported === 'name' && entry.name === PG_TABLE_EXPORT) constructors.add(entry.local)
    }
  }

  /** @type {{ pattern: Record<string, any>, source: Record<string, any> }[]} */
  const bindings = []
  for (const node of program.body ?? []) {
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node
    if (declaration?.type !== 'VariableDeclaration') continue
    for (const declarator of declaration.declarations ?? []) {
      if (declarator.init) bindings.push({ pattern: declarator.id, source: unwrap(declarator.init) })
    }
  }
  walk(program.body ?? [], (node) => {
    if (node.type !== 'AssignmentExpression' || node.operator !== '=') return
    const target = unwrap(node.left)
    if (target?.type === 'ObjectPattern' || target?.type === 'Identifier') {
      bindings.push({ pattern: target, source: unwrap(node.right) })
    }
  })

  for (let changed = true; changed;) {
    changed = false
    const add = (name) => {
      if (!name || constructors.has(name)) return
      constructors.add(name)
      changed = true
    }
    for (const { pattern, source } of bindings) {
      if (pattern?.type === 'Identifier' && isConstructorExpression(source, constructors, namespaces)) {
        add(pattern.name)
        continue
      }
      const fromNamespace = source?.type === 'Identifier' && namespaces.has(source.name)
      for (const local of destructuredConstructorNames(pattern, fromNamespace)) add(local)
    }
  }
  return { constructors, namespaces }
}

/**
 * Every use of the table constructor that is not a direct call with a literal
 * physical name.
 *
 * The constructor may be aliased and destructured, but it may never be
 * re-exported, stored, wrapped, invoked through `call`/`apply`/`bind`, reached
 * through a computed or optional member, or called with a name the check cannot
 * read. Transporting it is banned outright rather than traced between modules.
 *
 * @param {Record<string, any>} program
 * @param {{ constructors: Set<string>, namespaces: Set<string> }} identity
 * @param {{ exported: string | null, name: string, specifier: string }[]} reexports
 * @returns {string[]}
 */
function readConstructorMisuse(program, identity, reexports) {
  /** @type {Set<number>} */
  const sanctioned = new Set()
  /** @type {Set<string>} */
  const misuse = new Set()

  walk(program.body ?? [], (node) => {
    if (node.type !== 'CallExpression') return
    const callee = unwrap(node.callee)
    if (!isConstructorExpression(callee, identity.constructors, identity.namespaces)) return
    const first = unwrap(node.arguments?.[0])
    if (node.optional || first?.type !== 'Literal' || typeof first.value !== 'string') return
    sanctioned.add(callee.start)
  })

  // Reading a member off the namespace is how it is meant to be used, so the
  // receiver is not transport.
  walk(program.body ?? [], (node) => {
    if (node.type !== 'MemberExpression') return
    const object = unwrap(node.object)
    if (object?.type === 'Identifier' && identity.namespaces.has(object.name)) {
      sanctioned.add(object.start)
    }
  })

  // Binding the constructor is how an alias is created, so the bound pattern, the
  // constructor reference it reads, and a namespace destructured for one are not
  // uses; every other appearance is.
  const sanctionBinding = (pattern, source) => {
    walk(pattern, (child) => {
      if (child.type === 'Identifier') sanctioned.add(child.start)
    })
    const init = unwrap(source)
    if (!init) return
    if (isConstructorExpression(init, identity.constructors, identity.namespaces)) {
      sanctioned.add(init.start)
    }
    if (
      pattern?.type === 'ObjectPattern'
      && init.type === 'Identifier'
      && identity.namespaces.has(init.name)
    ) {
      sanctioned.add(init.start)
    }
  }
  for (const node of program.body ?? []) {
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node
    if (declaration?.type !== 'VariableDeclaration') continue
    for (const declarator of declaration.declarations ?? []) {
      sanctionBinding(declarator.id, declarator.init)
    }
  }
  walk(program.body ?? [], (node) => {
    if (node.type !== 'AssignmentExpression' || node.operator !== '=') return
    sanctionBinding(unwrap(node.left), node.right)
  })

  const body = (program.body ?? []).filter((node) => node.type !== 'ImportDeclaration')
  walk(body, (node) => {
    if (node.type === 'Identifier') {
      if (sanctioned.has(node.start)) return
      // A `drizzle-orm/pg-core` namespace carries the constructor, so moving the
      // namespace itself is transport and is banned exactly like moving `pgTable`.
      if (identity.namespaces.has(node.name)) {
        misuse.add(`the ${node.name} namespace`)
        return
      }
      if (!identity.constructors.has(node.name)) return
      misuse.add(node.name)
      return
    }
    if (node.type !== 'MemberExpression' || node.object?.type !== 'Identifier') return
    if (!identity.namespaces.has(node.object.name)) return
    const property = staticPropertyName(node)
    if (property === null) {
      misuse.add(`${node.object.name}[computed]`)
      return
    }
    if (property === PG_TABLE_EXPORT && !sanctioned.has(node.start)) {
      misuse.add(`${node.object.name}.${PG_TABLE_EXPORT}`)
    }
  })

  for (const reexport of reexports) {
    if (reexport.specifier !== PG_CORE_SPECIFIER) continue
    if (reexport.imported === 'all') {
      misuse.add(`a star re-export of ${PG_CORE_SPECIFIER}`)
      continue
    }
    if (reexport.name === PG_TABLE_EXPORT) misuse.add(reexport.exported ?? PG_TABLE_EXPORT)
  }
  return [...misuse].sort()
}

/**
 * The static shape of one expression, as far as the ES module system can hand it
 * to another module by name.
 *
 * @param {Record<string, any>} node
 * @param {{ constructors: Set<string>, namespaces: Set<string> }} identity
 * @returns {ValueNode}
 */
function readValue(node, identity) {
  const expression = unwrap(node)
  if (!expression) return { t: 'unresolved' }
  if (expression.type === 'Identifier') return { name: expression.name, t: 'ident' }

  if (expression.type === 'MemberExpression') {
    return {
      object: readValue(expression.object, identity),
      property: expression.optional ? null : staticPropertyName(expression),
      t: 'member',
    }
  }
  if (expression.type === 'ObjectExpression') {
    const props = (expression.properties ?? []).flatMap((property) => {
      if (property.type === 'SpreadElement') {
        return [{ name: null, spread: true, value: readValue(property.argument, identity) }]
      }
      if (property.type !== 'Property') return []
      return [{
        name: staticKeyName(property),
        spread: false,
        value: readValue(property.value, identity),
      }]
    })
    return { props, t: 'object' }
  }
  if (expression.type === 'CallExpression') {
    const callee = unwrap(expression.callee)
    const first = unwrap(expression.arguments?.[0])
    if (
      isConstructorExpression(callee, identity.constructors, identity.namespaces)
      && !expression.optional
      && first?.type === 'Literal'
      && typeof first.value === 'string'
    ) {
      return { t: 'table', table: first.value }
    }
  }
  return { t: 'unresolved' }
}

/**
 * @param {Record<string, any>} pattern
 * @param {ValueNode} source
 * @param {(name: string, value: ValueNode) => void} record
 * @returns {void}
 */
function recordPattern(pattern, source, record) {
  if (!pattern) return
  if (pattern.type === 'Identifier') {
    record(pattern.name, source)
    return
  }
  if (pattern.type === 'AssignmentPattern') {
    recordPattern(pattern.left, source, record)
    return
  }
  if (pattern.type === 'ObjectPattern') {
    for (const property of pattern.properties ?? []) {
      if (property.type !== 'Property') {
        const rest = property.argument ?? property.value
        if (rest) recordPattern(rest, { object: source, property: null, t: 'member' }, record)
        continue
      }
      recordPattern(
        property.value,
        { object: source, property: staticKeyName(property), t: 'member' },
        record,
      )
    }
    return
  }
  if (pattern.type === 'ArrayPattern') {
    for (const element of pattern.elements ?? []) {
      if (element) recordPattern(element, { object: source, property: null, t: 'member' }, record)
    }
  }
}

/**
 * Every exact `pgTable` call in the file, with how it is bound.
 *
 * A canonical declaration must be a direct call bound to a named value the module
 * statically exports. A call that is unbound, bound to a pattern, never exported,
 * or nested inside an array, function, or class is inventoried here so the caller
 * can refuse it rather than let the table vanish. The result is a list, not a map,
 * so a repeated physical name stays visible.
 *
 * @param {Record<string, any>} program
 * @param {{ constructors: Set<string>, namespaces: Set<string> }} identity
 * @param {Set<string>} exportedLocals
 * @returns {TableCall[]}
 */
function readTableCalls(program, identity, exportedLocals) {
  /** @type {Map<number, string | null>} */
  const bindings = new Map()
  for (const node of program.body ?? []) {
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node
    if (declaration?.type !== 'VariableDeclaration') continue
    for (const declarator of declaration.declarations ?? []) {
      const init = unwrap(declarator.init)
      if (init?.type !== 'CallExpression') continue
      bindings.set(init.start, declarator.id?.type === 'Identifier' ? declarator.id.name : null)
    }
  }

  /** @type {TableCall[]} */
  const calls = []
  walk(program.body ?? [], (node) => {
    if (node.type !== 'CallExpression') return
    const callee = unwrap(node.callee)
    if (!isConstructorExpression(callee, identity.constructors, identity.namespaces)) return
    const first = unwrap(node.arguments?.[0])
    if (node.optional || first?.type !== 'Literal' || typeof first.value !== 'string') return

    const name = bindings.get(node.start) ?? null
    calls.push({
      bound: Boolean(name),
      exported: Boolean(name && exportedLocals.has(name)),
      name,
      table: first.value,
    })
  })
  return calls
}

/**
 * @param {Record<string, any>} program
 * @param {{ entries: { imported: string, local: string, name: string }[], specifier: string }[]} staticImports
 * @param {{ exported: string | null, name: string, specifier: string }[]} reexports
 * @param {{ exported: string, local: string }[]} localExports
 * @returns {ValueFacts}
 */
export function readValueFacts(program, staticImports, reexports, localExports = []) {
  const identity = readTableConstructors(program, staticImports)
  /** @type {Record<string, ValueNode>} */
  const values = {}
  const record = (name, value) => {
    if (!(name in values)) values[name] = value
  }

  for (const node of program.body ?? []) {
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node
    if (declaration?.type !== 'VariableDeclaration') continue
    for (const declarator of declaration.declarations ?? []) {
      recordPattern(declarator.id, readValue(declarator.init, identity), record)
    }
  }

  return {
    constructorMisuse: readConstructorMisuse(program, identity, reexports),
    tableCalls: readTableCalls(program, identity, new Set(localExports.map((e) => e.local))),
    values,
  }
}
