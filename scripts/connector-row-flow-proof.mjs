import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { parseSync } from 'oxc-parser'

/**
 * Proof that no connector persistence row can cross the connectors public surface
 * (issue #327).
 *
 * The check reads emitted declarations rather than source, because a declaration
 * carries the type TypeScript *inferred*: a projection that accepts a row without
 * naming one, a factory whose return type was never written down, an alias, a
 * `ReturnType`, and a structural clone all appear in the emitted signature. Omitting
 * an explicit type export therefore hides nothing.
 *
 * Every name `public.ts` exports is followed to the declaration that defines it, and
 * every type identifier that declaration mentions is followed in turn, to a fixpoint.
 * Landing in a connectors row module — a port record file, the repository port, or
 * the store — is the violation, whatever route reached it.
 *
 * Consumers cannot bypass this: `module-public-surface-bypass` already proves that
 * production server and runtime code reaches connectors only through `public.ts`, so
 * what the surface cannot hand out, a consumer cannot hold.
 */
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const MODULE = 'connectors'
const ROW_MODULE =
  /(?:ports\/connector-[a-z-]+\.records|ports\/connector\.repository\.port|persistence\/connector(?:-[a-z-]+)?\.repository)$/
const REPOSITORY_FACTORY = 'createPgliteConnectorRepository'

const declarationRoot = fs.mkdtempSync(path.join(repositoryRoot, '.connector-row-proof-'))
const projectPath = path.join(declarationRoot, 'tsconfig.json')

/** @returns {string} The emitted declaration directory for the module. */
function emitDeclarations() {
  fs.writeFileSync(projectPath, JSON.stringify({
    extends: path.join(repositoryRoot, 'tsconfig.json'),
    compilerOptions: {
      declaration: true,
      emitDeclarationOnly: true,
      noEmit: false,
      noUnusedLocals: false,
      noUnusedParameters: false,
      outDir: declarationRoot,
      rootDir: repositoryRoot,
    },
    include: [path.join(repositoryRoot, `src/modules/${MODULE}/public.ts`)],
  }))
  // Declaration emit reports diagnostics for files outside the narrowed include;
  // the emitted output is what this proof reads, so a non-zero status is expected.
  try {
    execFileSync(
      process.execPath,
      [path.join(repositoryRoot, 'node_modules/typescript/bin/tsc'), '-p', projectPath],
      { cwd: repositoryRoot, encoding: 'utf8', stdio: 'pipe' },
    )
  } catch { /* diagnostics are not the artifact under proof */ }
  return path.join(declarationRoot, 'src', 'modules', MODULE)
}

/**
 * @param {string} filePath
 * @returns {{ exports: Map<string, string>, locals: Map<string, string>, imports: Map<string, string> }}
 */
function readDeclaration(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const parsed = parseSync(filePath, source)
  /** @type {Map<string, string>} Exported name -> specifier it is forwarded from. */
  const exports = new Map()
  /** @type {Map<string, string>} Locally declared name -> its declaration text. */
  const locals = new Map()
  /** @type {Map<string, string>} Imported name -> specifier. */
  const imports = new Map()

  for (const node of parsed.program.body) {
    if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers ?? []) {
        imports.set(specifier.local?.name ?? '', node.source.value)
      }
      continue
    }
    if (node.type === 'ExportNamedDeclaration' && node.source) {
      for (const specifier of node.specifiers ?? []) {
        exports.set(specifier.exported?.name ?? '', node.source.value)
      }
      continue
    }
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node
    if (!declaration) continue
    const text = source.slice(declaration.start, declaration.end)
    for (const name of declaredNames(declaration)) locals.set(name, text)
  }
  return { exports, imports, locals }
}

/**
 * @param {Record<string, any>} declaration
 * @returns {string[]}
 */
function declaredNames(declaration) {
  if (declaration.id?.name) return [declaration.id.name]
  return (declaration.declarations ?? []).flatMap((entry) => entry.id?.name ? [entry.id.name] : [])
}

/**
 * @param {string} directory
 * @param {string} specifier
 * @returns {string | null}
 */
function resolveDeclaration(directory, specifier) {
  if (!specifier.startsWith('.')) return null
  const target = path.resolve(directory, `${specifier}.d.ts`)
  return fs.existsSync(target) ? target : null
}

const moduleDirectory = emitDeclarations()
const surface = path.join(moduleDirectory, 'public.d.ts')
if (!fs.existsSync(surface)) throw new Error(`No emitted declaration for ${MODULE}/public.ts`)

/** @type {string[]} */
const violations = []
const visited = new Set()

/**
 * @param {string} filePath
 * @param {string} name
 * @param {string[]} trail
 * @returns {void}
 */
function follow(filePath, name, trail) {
  const key = `${filePath}|${name}`
  if (visited.has(key)) return
  visited.add(key)

  const relative = path.relative(moduleDirectory, filePath).replace(/\.d\.ts$/, '')
  if (ROW_MODULE.test(relative) || name === REPOSITORY_FACTORY) {
    violations.push(
      `[connector-persistence-row-flow] ${trail.join(' -> ')} reaches ${relative === 'public' ? name : `${relative}.${name}`}; the connectors public surface hands out no repository and no persistence row`,
    )
    return
  }

  const declaration = readDeclaration(filePath)
  const forwarded = declaration.exports.get(name)
  if (forwarded !== undefined) {
    const target = resolveDeclaration(path.dirname(filePath), forwarded)
    if (target) follow(target, name, [...trail, `${relative}:${name}`])
    return
  }

  const text = declaration.locals.get(name)
  if (text === undefined) return
  for (const identifier of new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? [])) {
    if (identifier === name) continue
    const importedFrom = declaration.imports.get(identifier)
    if (importedFrom !== undefined) {
      const target = resolveDeclaration(path.dirname(filePath), importedFrom)
      if (target) follow(target, identifier, [...trail, `${relative}:${name}`])
      continue
    }
    if (declaration.locals.has(identifier)) follow(filePath, identifier, [...trail, `${relative}:${name}`])
  }
}

const surfaceDeclaration = readDeclaration(surface)
const exportedNames = [...surfaceDeclaration.exports.keys(), ...surfaceDeclaration.locals.keys()]
for (const name of exportedNames) follow(surface, name, [`public:${name}`])

fs.rmSync(declarationRoot, { force: true, recursive: true })

const unique = [...new Set(violations)].sort()
for (const violation of unique) process.stderr.write(`${violation}\n`)
process.stdout.write(
  `connectors public surface: ${exportedNames.length} exported names, ${visited.size} declarations followed, ${unique.length} persistence-row violation(s)\n`,
)
if (unique.length > 0) process.exitCode = 1
