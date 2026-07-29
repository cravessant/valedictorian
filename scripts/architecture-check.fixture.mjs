import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const checkScript = fileURLToPath(new URL('./architecture-check.mjs', import.meta.url))

const REASON = 'Recorded exactly for this fixture so the entry explains itself.'

/**
 * A minimal repository the check accepts: two capability modules, one owned table
 * each, one declared edge, a platform file outside `src/modules`, and one exact
 * transitional exception covering the single foreign-owner table import. Every
 * mutation starts from this tree and changes one thing, so a failure names one
 * cause.
 *
 * @returns {Record<string, string>}
 */
export function passingFixture() {
  return {
    'src/runtime/runtime.ts':
      "import { jobs } from '../modules/job/job.schema'\n\nvoid jobs\nexport const columns = 1\n",
    'architecture/module-graph.json': JSON.stringify({
      canonicalSchemaAggregate: 'src/db/schema.ts',
      edges: [{ from: 'capture', recordedIn: '#326', to: 'job' }],
      exceptions: [runtimeReadsJobs()],
      moduleRoot: 'src/modules',
      permissions: [captureAccessesJobs()],
      retiringIssues: ['#327', '#328', '#491'],
      schemaRegistrar: 'src/db/pglite.ts',
      stamps: ['#326'],
    }),
    'architecture/state-ownership.json': JSON.stringify({
      owners: {
        capture: { kind: 'capability', module: 'src/modules/capture' },
        job: { kind: 'capability', module: 'src/modules/job' },
      },
      schemaModules: [
        'src/modules/capture/capture.schema.ts',
        'src/modules/job/job.schema.ts',
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
      },
    }),
    'src/db/pglite.ts': 'export const database = () => undefined\n',
    'src/db/schema.ts': "export const version = 'fixture'\n",
    'src/modules/capture/capture.schema.ts':
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nexport const captures = pgTable('captures', {})\n",
    'src/modules/capture/capture.service.ts':
      "import { jobs } from '../job/job.schema'\n\nvoid jobs\nexport const columns = 1\n",
    'src/modules/job/job.schema.ts':
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nexport const jobs = pgTable('jobs', {})\n",
  }
}

/** @returns {Record<string, string>} */
export function runtimeReadsJobs() {
  return {
    owner: 'job',
    reason: 'Transitional: runtime reaches the job schema directly until #327 lands.',
    recordedIn: '#326',
    retiredBy: '#327',
    rule: 'foreign-owner-table-access',
    source: 'src/runtime/runtime.ts',
    table: 'jobs',
    target: 'src/modules/job/job.schema.ts',
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
      edges: [{ from: 'capture', recordedIn: '#326', to: 'job' }],
      exceptions: [runtimeReadsJobs()],
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
      retiringIssues: ['#327', '#328', '#491'],
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
