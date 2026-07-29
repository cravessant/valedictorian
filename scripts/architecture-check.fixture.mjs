import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const checkScript = fileURLToPath(new URL('./architecture-check.mjs', import.meta.url))

const REASON = 'Recorded exactly for this fixture so the entry explains itself.'

/**
 * A minimal repository the check accepts: four capability modules, one owned table
 * each where state is modelled, two declared edges, platform files outside
 * `src/modules`, and a runtime file reaching a capability the one way that is
 * allowed — a named value and type import from that module's exact public surface.
 * Every mutation starts from this tree and changes one thing, so a failure names one
 * cause.
 *
 * It carries no transitional exception and nothing retiring, which is the steady
 * state the real manifest reached: connectors reaches source-execution through an
 * owner operation rather than that owner's tables.
 *
 * @returns {Record<string, string>}
 */
export function passingFixture() {
  return {
    'src/runtime/runtime.ts': [
      "import { runJob, type JobRun } from '../modules/job/public'",
      '',
      'export const columns = (run: JobRun) => runJob(run)',
      '',
    ].join('\n'),
    'architecture/module-graph.json': JSON.stringify({
      canonicalSchemaAggregate: 'src/db/schema.ts',
      edges: [
        { from: 'capture', recordedIn: '#326', to: 'job' },
        { from: 'connectors', recordedIn: '#326', to: 'source-execution' },
      ],
      exceptions: [],
      moduleRoot: 'src/modules',
      permissions: [captureAccessesJobs()],
      retiringIssues: [],
      schemaRegistrar: 'src/db/pglite.ts',
      stamps: ['#326'],
    }),
    'architecture/state-ownership.json': JSON.stringify({
      owners: {
        capture: { kind: 'capability', module: 'src/modules/capture' },
        connectors: { kind: 'capability', module: 'src/modules/connectors' },
        job: { kind: 'capability', module: 'src/modules/job' },
        'source-execution': { kind: 'capability', module: 'src/modules/source-execution' },
      },
      schemaModules: [
        'src/modules/capture/capture.schema.ts',
        'src/modules/job/job.schema.ts',
        'src/modules/source-execution/source-execution.schema.ts',
      ],
      tables: {
        captures: {
          owner: 'capture',
          schemaExport: 'captures',
          schemaModule: 'src/modules/capture/capture.schema.ts',
        },
        jobs: {
          owner: 'job',
          schemaExport: 'jobs',
          schemaModule: 'src/modules/job/job.schema.ts',
        },
        source_execution_scopes: {
          owner: 'source-execution',
          schemaExport: 'sourceExecutionScopes',
          schemaModule: 'src/modules/source-execution/source-execution.schema.ts',
        },
      },
    }),
    'src/db/pglite.ts': 'export const database = () => undefined\n',
    'src/db/schema.ts': "export const version = 'fixture'\n",
    'src/modules/capture/capture.schema.ts':
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nexport const captures = pgTable('captures', {})\n",
    'src/modules/capture/capture.service.ts':
      "import { jobs } from '../job/job.schema'\n\nvoid jobs\nexport const columns = 1\n",
    'src/modules/connectors/connector.repository.ts': [
      "import { ensureScope } from '../source-execution/source-execution.persistence'",
      '',
      'export const repository = ensureScope',
      '',
    ].join('\n'),
    'src/modules/job/job.schema.ts':
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nexport const jobs = pgTable('jobs', {})\n",
    'src/modules/job/job.service.ts': [
      'export interface JobRun { readonly id: string }',
      '',
      'export const runJob = (run: JobRun) => run.id',
      '',
    ].join('\n'),
    'src/modules/job/public.ts': "export { runJob, type JobRun } from './job.service'\n",
    'src/modules/source-execution/source-execution.persistence.ts': [
      "import { sourceExecutionScopes } from './source-execution.schema'",
      '',
      'export const ensureScope = () => sourceExecutionScopes',
      '',
    ].join('\n'),
    'src/modules/source-execution/source-execution.schema.ts': [
      "import { pgTable } from 'drizzle-orm/pg-core'",
      '',
      "export const sourceExecutionScopes = pgTable('source_execution_scopes', {})",
      '',
    ].join('\n'),
  }
}

/**
 * A transitional exception the tree no longer carries. Every rule that governs the
 * exception set is exercised against it, so the shape stays checked now that the
 * manifest records none.
 *
 * @returns {Record<string, string>}
 */
export function transitionalException() {
  return {
    owner: 'source-execution',
    reason: 'Transitional: connectors mutates a source-execution table for now.',
    recordedIn: '#326',
    retiredBy: '#999',
    rule: 'foreign-owner-table-access',
    source: 'src/modules/connectors/connector.repository.ts',
    table: 'source_execution_scopes',
    target: 'src/modules/source-execution/source-execution.schema.ts',
  }
}

/** @returns {Record<string, string>} */
export function captureAccessesJobs() {
  return {
    owner: 'job',
    purpose: 'cross-capability-state-access',
    reason: 'Recorded: capture reaches the job table across the capability boundary.',
    recordedIn: '#326',
    source: 'src/modules/capture/capture.service.ts',
    table: 'jobs',
    target: 'src/modules/job/job.schema.ts',
  }
}

/**
 * @param {Record<string, string>} overrides
 * @returns {Record<string, string>}
 */
export function permission(overrides) {
  return {
    owner: 'job',
    purpose: 'schema-composition',
    reason: REASON,
    recordedIn: '#326',
    source: 'src/db/schema.ts',
    table: 'jobs',
    target: 'src/modules/job/job.schema.ts',
    ...overrides,
  }
}

/**
 * The base tree plus the canonical aggregate composing both tables and the
 * registrar handing that aggregate to the database client, mirroring
 * `src/db/schema.ts` and `src/db/pglite.ts`.
 *
 * @returns {Record<string, string>}
 */
export function aggregateFixture() {
  const files = passingFixture()
  return {
    ...files,
    'architecture/module-graph.json': JSON.stringify({
      canonicalSchemaAggregate: 'src/db/schema.ts',
      edges: [
        { from: 'capture', recordedIn: '#326', to: 'job' },
        { from: 'connectors', recordedIn: '#326', to: 'source-execution' },
      ],
      exceptions: [],
      moduleRoot: 'src/modules',
      permissions: [
        captureAccessesJobs(),
        permission({}),
        permission({
          owner: 'capture',
          table: 'captures',
          target: 'src/modules/capture/capture.schema.ts',
        }),
        permission({ purpose: 'schema-registration', source: 'src/db/pglite.ts', target: 'src/db/schema.ts' }),
        permission({
          owner: 'capture',
          purpose: 'schema-registration',
          source: 'src/db/pglite.ts',
          table: 'captures',
          target: 'src/db/schema.ts',
        }),
      ],
      retiringIssues: [],
      schemaRegistrar: 'src/db/pglite.ts',
      stamps: ['#326'],
    }),
    'src/db/schema.ts': [
      "import { captures } from '../modules/capture/capture.schema'",
      "import { jobs } from '../modules/job/job.schema'",
      '',
      'export const schema = { captures, jobs }',
      '',
    ].join('\n'),
    'src/db/pglite.ts': [
      "import { schema } from './schema'",
      '',
      'void schema',
      "export const database = 'ready'",
      '',
    ].join('\n'),
  }
}

/**
 * @param {Record<string, string>} files
 * @param {string[]} roots Collects created roots so the caller can remove them.
 * @returns {string}
 */
export function writeFixture(files, roots) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-architecture-'))
  roots.push(root)

  for (const [filePath, source] of Object.entries(files)) {
    const absolutePath = path.join(root, filePath)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, source)
  }
  return root
}

/**
 * @param {string} root
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
export function runArchitectureCheck(root) {
  return spawnSync(process.execPath, [checkScript, '--root', root], { encoding: 'utf8' })
}

/**
 * @param {Record<string, string>} files
 * @param {(manifest: any) => void} mutate
 * @returns {Record<string, string>}
 */
export function withModuleGraph(files, mutate) {
  const manifest = JSON.parse(/** @type {string} */ (files['architecture/module-graph.json']))
  mutate(manifest)
  return { ...files, 'architecture/module-graph.json': JSON.stringify(manifest) }
}

/**
 * @param {Record<string, string>} files
 * @param {(manifest: any) => void} mutate
 * @returns {Record<string, string>}
 */
export function withStateOwnership(files, mutate) {
  const manifest = JSON.parse(/** @type {string} */ (files['architecture/state-ownership.json']))
  mutate(manifest)
  return { ...files, 'architecture/state-ownership.json': JSON.stringify(manifest) }
}
