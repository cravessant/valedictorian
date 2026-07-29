import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { loadModuleGraph, observedStateAccess } from './architecture-module-graph-rules.mjs'
import { isMaintainedTestPath } from './architecture-policy-rules.mjs'
import { loadStateOwnership, ownerByTable } from './architecture-state-ownership-rules.mjs'
import { scanMaintainedSource } from './architecture-state-resolution.mjs'

/**
 * Attacks on the source-execution write boundary (issue #491).
 *
 * Each case is a mutation of the real tree, because the boundary is a claim about
 * these exact files. The laundering cases are the ones a text proof gets wrong: an
 * owner call deleted but named in a comment or a string, and a table reached by raw
 * SQL rather than by import. None of them can be waved through by a module-graph
 * permission or exception, since this proof never reads the manifest.
 */

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const proofScript = path.join(repositoryRoot, 'scripts/source-execution-ownership-proof.mjs')

const PERSISTENCE = 'src/modules/connectors/adapters/persistence'
const ADMISSION = `${PERSISTENCE}/connector-run-request.repository.ts`
const INSTANCE_STORE = `${PERSISTENCE}/connector-instance.repository.ts`
const INSTANCE = `${PERSISTENCE}/connector-instance.persistence.ts`
const RETIREMENT = `${PERSISTENCE}/connector-retirement.persistence.ts`
const SCHEDULE = `${PERSISTENCE}/connector-schedule.repository.ts`
const SCHEMA = `${PERSISTENCE}/connector.schema.ts`

/** @type {Map<string, string>} */
const originals = new Map()

/** @param {string} repositoryPath @returns {string} */
function read(repositoryPath) {
  const absolutePath = path.join(repositoryRoot, repositoryPath)
  if (!originals.has(repositoryPath)) {
    originals.set(repositoryPath, fs.readFileSync(absolutePath, 'utf8'))
  }
  return /** @type {string} */ (originals.get(repositoryPath))
}

/** @param {string} repositoryPath @param {(source: string) => string} mutate */
function write(repositoryPath, mutate) {
  const source = read(repositoryPath)
  fs.writeFileSync(path.join(repositoryRoot, repositoryPath), mutate(source))
}

/** @returns {{ status: number, stdout: string, stderr: string }} */
function runProof() {
  try {
    const stdout = execFileSync(process.execPath, [proofScript], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return { status: 0, stderr: '', stdout }
  } catch (error) {
    const failure = /** @type {{ status: number, stderr: string, stdout: string }} */ (error)
    return { status: failure.status, stderr: failure.stderr, stdout: failure.stdout }
  }
}

afterEach(() => {
  for (const [repositoryPath, source] of originals) {
    fs.writeFileSync(path.join(repositoryRoot, repositoryPath), source)
  }
  originals.clear()
})

describe('source-execution write ownership', () => {
  it('accepts the checked-in tree', () => {
    const result = runProof()

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('0 violation(s)')
  })

  it.each([
    ['an update statement', "`update source_execution_scopes set status = 'available'`"],
    ['the retired claim predicate', '`exists (select 1 from source_execution_scopes scope where scope.id = $1)`'],
    ['a session delete', '`delete from source_execution_sessions`'],
    ['a plain string', "'select blocked_until from source_execution_scopes'"],
  ])('rejects %s naming an owner table in raw SQL', (_label, expression) => {
    write(ADMISSION, (source) => `${source}\nexport const probe = () => ${expression}\n`)

    const result = runProof()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`[source-execution-write-ownership] ${ADMISSION} names source_execution_`)
    expect(result.stderr).toContain('not through SQL the module graph cannot read')
  })

  it.each([
    ['the canonical aggregate', "import { sourceExecutionScopes } from '../../db/schema'"],
    ['the owner schema slice', "import { sourceExecutionScopes } from '../source-execution/source-execution.schema'"],
    ['an alias', "import { sourceExecutionScopes as scopes } from '../../db/schema'\nvoid scopes"],
  ])('rejects a direct table import from %s', (_label, statement) => {
    write(ADMISSION, (source) => `${statement}\n${source}`)

    const result = runProof()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `[source-execution-write-ownership] ${ADMISSION} reaches sourceExecutionScopes, owned by source-execution;`,
    )
  })

  it('rejects a table reached as a namespace member', () => {
    write(ADMISSION, (source) => [
      "import * as canonicalSchema from '../../db/schema'",
      source,
      'export const probe = () => canonicalSchema.sourceExecutionScopes',
      '',
    ].join('\n'))

    const result = runProof()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `[source-execution-write-ownership] ${ADMISSION} reaches sourceExecutionScopes, owned by source-execution;`,
    )
  })

  /**
   * Deletes the first call to `operation` outright — arguments and all, however many
   * lines it spans — and leaves its text behind the way the attack does.
   *
   * @param {string} source
   * @param {string} operation
   * @param {(call: string) => string} launder
   * @returns {string}
   */
  function launderCall(source, operation, launder) {
    const start = source.indexOf(`${operation}(`)
    expect(start).toBeGreaterThan(-1)
    let depth = 0
    let end = source.indexOf('(', start)
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1
      if (source[end] === ')' && --depth === 0) break
    }
    const call = source.slice(start, end + 1).replace(/\s+/g, ' ')
    return `${source.slice(0, start)}undefined${source.slice(end + 1)}\n${launder(call)}\n`
  }

  it.each([
    ['a comment', ADMISSION, 'admitSourceExecutionScope', 1, (call) => `// ${call}`],
    ['a comment', INSTANCE_STORE, 'ensureSourceExecutionScope', 0, (call) => `// ${call}`],
    ['a comment', INSTANCE, 'ensureSourceExecutionScope', 0, (call) => `// ${call}`],
    ['a comment', RETIREMENT, 'retireSourceExecutionScope', 0, (call) => `// ${call}`],
    ['a string', ADMISSION, 'admitSourceExecutionScope', 1, (call) => `void ${JSON.stringify(call)}`],
    ['a string', INSTANCE, 'ensureSourceExecutionScope', 0, (call) => `void ${JSON.stringify(call)}`],
  ])('rejects an owner call deleted but left in %s', (_label, file, operation, remaining, launder) => {
    write(file, (source) => launderCall(source, operation, launder))

    const result = runProof()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `[source-execution-write-ownership] ${file} calls ${operation} from source-execution/source-execution.persistence ${remaining} time(s), not the`,
    )
    expect(result.stderr).toContain('naming it in a comment or a string is not a call')
  })

  /**
   * The post-claim readmission is a second call to the same operation, so only a
   * count pins it: deleting it leaves the first admission and every name in place.
   */
  it('rejects dropping the post-claim readmission and keeping the first admission', () => {
    write(ADMISSION, (source) => launderCall(source, 'admitSourceExecutionScope', (call) => `// ${call}`))

    const result = runProof()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `[source-execution-write-ownership] ${ADMISSION} calls admitSourceExecutionScope from source-execution/source-execution.persistence 1 time(s), not the 2 its contract needs;`,
    )
  })

  it('rejects a retained read whose access is gone', () => {
    write(SCHEDULE, (source) =>
      source.replace(/import \{[^}]*sourceExecutionScopes[^}]*\} from '[^']*'\n/, ''))

    const result = runProof()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `[source-execution-write-ownership] ${SCHEDULE} no longer reaches sourceExecutionScopes;`,
    )
  })
})

describe('source-execution ownership in the module graph', () => {
  const ownership = /** @type {NonNullable<ReturnType<typeof loadStateOwnership>>} */ (
    loadStateOwnership(repositoryRoot)
  )
  const moduleGraph = /** @type {NonNullable<ReturnType<typeof loadModuleGraph>>} */ (
    loadModuleGraph(repositoryRoot)
  )
  const observed = observedStateAccess(
    scanMaintainedSource(repositoryRoot),
    ownerByTable(ownership),
  )

  it('leaves connectors production source only the two retained reads', () => {
    const reaches = [...observed.accesses.values()].filter(
      (access) => access.owner === 'source-execution'
        && access.source.startsWith('src/modules/connectors/')
        && !isMaintainedTestPath(access.source),
    )

    expect(reaches.map((access) => `${access.source}|${access.table}`).sort()).toEqual([
      `${SCHEDULE}|source_execution_scopes`,
      `${SCHEMA}|source_execution_scopes`,
    ])
  })

  it('records no transitional exception and no retiring issue', () => {
    expect(moduleGraph.exceptions).toEqual([])
    expect(moduleGraph.retiringIssues).toEqual([])
  })

  it('runs inside the single lint path', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'))

    expect(manifest.scripts['lint:source-execution-ownership'])
      .toBe('node scripts/source-execution-ownership-proof.mjs')
    expect(manifest.scripts.lint).toContain('pnpm run lint:source-execution-ownership')
  })
})
