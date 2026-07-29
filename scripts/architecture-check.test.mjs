import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'

import {
  aggregateFixture,
  captureAccessesJobs,
  passingFixture,
  permission,
  runArchitectureCheck,
  transitionalException,
  withModuleGraph,
  withStateOwnership,
  writeFixture,
} from './architecture-check.fixture.mjs'

/** @type {string[]} */
const fixtureRoots = []

/**
 * @param {Record<string, string>} files
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
function check(files) {
  return runArchitectureCheck(writeFixture(files, fixtureRoots))
}

const foreignJobs = (source, zone = 'capture') =>
  `[foreign-owner-table-access] ${source} imports jobs owned by job; zone ${zone} needs an exact entry in architecture/module-graph.json\n`

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) fs.rmSync(root, { recursive: true })
})

describe('architecture check manifests', () => {
  it('accepts a tree whose manifests describe it exactly', () => {
    const result = check(passingFixture())

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('rejects a table with no declared owner', () => {
    const files = passingFixture()
    const result = check({
      ...files,
      'src/modules/job/job.schema.ts':
        `${files['src/modules/job/job.schema.ts']}export const jobHistory = pgTable('job_history', {})\n`,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[unowned-state] src/modules/job/job.schema.ts exports job_history as jobHistory without a matching entry in architecture/state-ownership.json\n',
    )
  })

  it('rejects a sibling-module import on an undeclared edge', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/job.service.ts':
        "import { columns } from '../capture/capture.service'\n\nexport const run = columns\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[undeclared-module-edge] src/modules/job/job.service.ts imports src/modules/capture/capture.service.ts; module edge job -> capture is not declared in architecture/module-graph.json\n',
    )
  })

  it('rejects a foreign-owner table import with no exact-path exception', () => {
    const files = withModuleGraph(passingFixture(), (manifest) => {
      manifest.edges.push({ from: 'job', recordedIn: '#326', to: 'capture' })
    })
    const result = check({
      ...files,
      'src/modules/job/job.repository.ts':
        "import { captures } from '../capture/capture.schema'\n\nexport const read = () => captures\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[foreign-owner-table-access] src/modules/job/job.repository.ts imports captures owned by capture; zone job needs an exact entry in architecture/module-graph.json\n',
    )
  })

  it.each([
    ['a directory', 'src/runtime', 'is not an exact repository file'],
    ['a glob', 'src/runtime/*.ts', 'uses a pattern for source'],
  ])('rejects an exception broadened to %s', (_label, source, expected) => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      manifest.exceptions = [{ ...transitionalException(), source }]
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`[broadened-architecture-exception]`)
    expect(result.stderr).toContain(expected)
  })

  it('rejects an exception broadened by dropping the table it covers', () => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      const { table: _table, ...withoutTable } = transitionalException()
      manifest.exceptions = [withoutTable]
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[broadened-architecture-exception] architecture/module-graph.json entry foreign-owner-table-access src/modules/connectors/connector.repository.ts -> src/modules/source-execution/source-execution.schema.ts must carry exactly owner, reason, recordedIn, retiredBy, rule, source, table, target\n',
    )
  })

  it('rejects an exception relaxing a rule the check does not define', () => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      manifest.exceptions = [{ ...transitionalException(), rule: 'everything' }]
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('names rule everything, which no rule in this check relaxes\n')
  })

  it('rejects an exception that no longer matches an import', () => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      manifest.exceptions = [transitionalException()]
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[stale-architecture-exception] architecture/module-graph.json exception foreign-owner-table-access src/modules/connectors/connector.repository.ts -> src/modules/source-execution/source-execution.schema.ts for source_execution_scopes matches no maintained import\n',
    )
  })

  it('rejects an edge no production import supports', () => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      manifest.edges.push({ from: 'job', recordedIn: '#326', to: 'capture' })
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[stale-module-edge] architecture/module-graph.json declares edge job -> capture, which no production import supports\n',
    )
  })

  it('rejects an ownership entry whose table is gone', () => {
    const result = check(withStateOwnership(passingFixture(), (manifest) => {
      manifest.tables.job_history = {
        owner: 'job',
        schemaExport: 'jobHistory',
        schemaModule: 'src/modules/job/job.schema.ts',
      }
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[stale-state-ownership] architecture/state-ownership.json entry job_history claims export jobHistory in src/modules/job/job.schema.ts, which no longer declares it\n',
    )
  })

  it('rejects an unstamped edge', () => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      manifest.edges = [{ from: 'capture', recordedIn: '#999', to: 'job' }]
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[unstamped-module-edge] architecture/module-graph.json edge capture -> job is not stamped by a declared issue reference\n',
    )
  })

  it.each([
    ['is not an issue reference', 'someday'],
    ['is not a declared retiring issue', '#999'],
  ])('rejects an exception whose retirement claim %s', (_label, retiredBy) => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      manifest.exceptions = [{ ...transitionalException(), retiredBy }]
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `[untruthful-retirement-claim] architecture/module-graph.json exception foreign-owner-table-access src/modules/connectors/connector.repository.ts -> src/modules/source-execution/source-execution.schema.ts claims retirement by ${retiredBy}, which is not a declared retiring issue\n`,
    )
  })

  it('reports every violation once, sorted, so reruns are identical', () => {
    const files = withModuleGraph(passingFixture(), (manifest) => {
      manifest.edges.push({ from: 'job', recordedIn: '#326', to: 'capture' })
    })
    const root = writeFixture(files, fixtureRoots)

    const first = runArchitectureCheck(root)
    const second = runArchitectureCheck(root)
    const reported = first.stderr.trim().split('\n')

    expect(first.stderr).toBe(second.stderr)
    expect(reported).toEqual(reported.toSorted())
  })
})

describe('computed module specifiers', () => {
  it.each([
    ['concatenation', "export const load = () => import('../job/' + 'job.schema')\n"],
    ['a variable', "const target = '../job/job.schema'\nexport const load = () => import(target)\n"],
    ['a template literal', 'export const load = () => import(`../job/job.schema`)\n'],
    ['a substituted template', 'export const load = (n) => import(`../job/${n}.schema`)\n'],
  ])('refuses a dynamic import built from %s', (_label, source) => {
    const result = check({ ...passingFixture(), 'src/modules/capture/capture.load.ts': source })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[computed-module-import] src/modules/capture/capture.load.ts imports a module whose specifier is computed; a target that cannot be read from the source cannot be stamped, so it is refused\n',
    )
  })

  it('refuses a computed dynamic import in platform code too', () => {
    const result = check({
      ...passingFixture(),
      'src/runtime/runtime.ts': "const t = './x'\nexport const load = () => import(t)\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[computed-module-import] src/runtime/runtime.ts')
  })
})

describe('aggregate and alias attribution', () => {
  it('accepts an aggregate whose every table is recorded', () => {
    const result = check(aggregateFixture())

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('attributes every table behind an aggregate import', () => {
    const result = check({
      ...aggregateFixture(),
      'src/runtime/runtime.ts':
        "import { schema } from '../db/schema'\n\nexport const boot = () => schema.jobs\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(foreignJobs('src/runtime/runtime.ts', 'src/runtime'))
    expect(result.stderr).toContain(
      '[foreign-owner-table-access] src/runtime/runtime.ts imports captures owned by capture; zone src/runtime needs an exact entry in architecture/module-graph.json\n',
    )
  })

  it('attributes every table behind an aggregate forwarded under a new name', () => {
    const result = check({
      ...aggregateFixture(),
      'src/db/all-tables.ts': "export { schema as allTables } from './schema'\n",
      'src/runtime/runtime.ts':
        "import { allTables } from '../db/all-tables'\n\nexport const boot = () => allTables\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(foreignJobs('src/runtime/runtime.ts', 'src/runtime'))
  })

  it('follows a renamed table export through a barrel', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/job.barrel.ts': "export { jobs as postings } from './job.schema'\n",
      'src/modules/capture/capture.read.ts':
        "import { postings } from '../job/job.barrel'\n\nexport const read = postings\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(foreignJobs('src/modules/capture/capture.read.ts'))
  })

  it('follows a renamed table export through several barrels', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/job.first.ts': "export { jobs as postings } from './job.schema'\n",
      'src/modules/job/job.second.ts': "export { postings as listings } from './job.first'\n",
      'src/modules/job/job.third.ts': "export { listings as roles } from './job.second'\n",
      'src/modules/capture/capture.read.ts':
        "import { roles } from '../job/job.third'\n\nexport const read = roles\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(foreignJobs('src/modules/capture/capture.read.ts'))
  })

  it('follows a table through a local alias re-export', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/job.barrel.ts':
        "import { jobs } from './job.schema'\n\nexport { jobs as postings }\n",
      'src/modules/capture/capture.read.ts':
        "import { postings } from '../job/job.barrel'\n\nexport const read = postings\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(foreignJobs('src/modules/capture/capture.read.ts'))
  })

  it('rejects an aggregate permission dropped for one member', () => {
    const result = check(withModuleGraph(aggregateFixture(), (manifest) => {
      manifest.permissions = manifest.permissions.filter(
        (entry) => entry.source !== 'src/db/schema.ts' || entry.table !== 'jobs',
      )
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(foreignJobs('src/db/schema.ts', 'src/db'))
  })

  it('rejects a permission for a table the aggregate no longer carries', () => {
    const files = aggregateFixture()
    const result = check({
      ...files,
      'src/db/schema.ts': [
        "import { captures } from '../modules/capture/capture.schema'",
        '',
        'export const schema = { captures }',
        '',
      ].join('\n'),
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[stale-architecture-permission] architecture/module-graph.json permission schema-composition src/db/schema.ts -> src/modules/job/job.schema.ts for jobs matches no maintained import\n',
    )
  })
})

describe('opaque state access', () => {
  it.each([
    ['namespace import', "import * as schema from '../job/job.schema'\nexport const read = schema\n", 'namespace'],
    ['star re-export', "export * from '../job/job.schema'\n", 'star'],
    ['star re-export alias', "export * as schema from '../job/job.schema'\n", 'star'],
    ['default import', "import jobs from '../job/job.schema'\nexport const read = jobs\n", 'default'],
    ['mixed default import', "import jobs, { captures } from '../job/job.schema'\nexport const read = [jobs, captures]\n", 'default'],
    ['bare import', "import '../job/job.schema'\n", 'bare'],
    ['literal dynamic import', "export const read = () => import('../job/job.schema')\n", 'dynamic'],
    ['default re-export', "export { default as jobs } from '../job/job.schema'\n", 'default'],
  ])('refuses a %s of a state module', (_label, source, kind) => {
    const result = check({ ...passingFixture(), 'src/modules/capture/capture.read.ts': source })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `[opaque-state-import] src/modules/capture/capture.read.ts reaches src/modules/job/job.schema.ts through a ${kind} import; owned tables must be named one by one so ownership stays attributable\n`,
    )
  })
})

describe('scan coverage', () => {
  it.each([
    ['a .test-helpers file', 'src/modules/job/job.test-helpers.ts'],
    ['a .test-harness file', 'src/modules/job/job.test-harness.ts'],
    ['a file under src/test', 'src/test/job-support.ts'],
    ['a .fixture file', 'src/modules/job/job.fixture.ts'],
  ])('sees state laundered through %s', (_label, supportPath) => {
    const relative = supportPath.startsWith('src/test/')
      ? '../modules/job/job.schema'
      : './job.schema'
    const consumerImport = supportPath.replace(/^src\//, '../').replace(/\.ts$/, '')
    const result = check({
      ...passingFixture(),
      [supportPath]: `export { jobs } from '${relative}'\n`,
      'src/runtime/runtime.ts':
        `import { jobs } from '${consumerImport}'\n\nexport const boot = () => jobs\n`,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(foreignJobs('src/runtime/runtime.ts', 'src/runtime'))
  })

  it('sees state laundered through several support hops', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/job.test-harness.ts': "export { jobs as postings } from './job.schema'\n",
      'src/modules/job/job.test-helpers.ts': "export { postings } from './job.test-harness'\n",
      'src/test/job-support.ts': "export { postings as roles } from '../modules/job/job.test-helpers'\n",
      'src/runtime/runtime.ts':
        "import { roles } from '../test/job-support'\n\nexport const boot = () => roles\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(foreignJobs('src/runtime/runtime.ts', 'src/runtime'))
  })

  it('records a test file reaching another module state', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/capture/capture.pglite.test.ts':
        "import { jobs } from '../job/job.schema'\n\nexport const arranged = jobs\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(foreignJobs('src/modules/capture/capture.pglite.test.ts'))
  })

  it('leaves the directed edge inventory to production module source', () => {
    const result = check({
      ...withModuleGraph(passingFixture(), (manifest) => {
        manifest.permissions.push({
          ...captureAccessesJobs(),
          owner: 'capture',
          purpose: 'test-state-access',
          source: 'src/modules/job/job.uses-capture.test.ts',
          table: 'captures',
          target: 'src/modules/capture/capture.schema.ts',
        })
      }),
      'src/modules/job/job.uses-capture.test.ts':
        "import { captures } from '../capture/capture.schema'\n\nexport const asserted = 1\nvoid captures\n",
    })

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })
})

describe('syntax-aware reading', () => {
  it('reads a specifier containing angle brackets without rewriting it', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/a>b.schema.ts': "export { jobs } from './job.schema'\n",
      'src/modules/capture/CapturePanel.tsx': [
        "import { jobs } from '../job/a>b.schema'",
        '',
        'export function CapturePanel() {',
        '  return <section aria-label="c">{String(jobs)}</section>',
        '}',
        '',
      ].join('\n'),
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(foreignJobs('src/modules/capture/CapturePanel.tsx'))
  })

  it.each([
    ['a regular expression', 'const pattern = /a<b\\/>c/'],
    ['a template literal', 'const label = `x </y> ${String(1)}`'],
    ['a string literal', "const label = '</section><br />'"],
  ])('keeps reading past %s next to JSX', (_label, statement) => {
    const result = check({
      ...passingFixture(),
      'src/modules/capture/CapturePanel.tsx': [
        'export function CapturePanel() {',
        `  ${statement}`,
        '  return <section>{[1, 2].map((n) => <span key={n}>{n / 2}</span>)}</section>',
        '}',
        '',
        "import { jobs } from '../job/job.schema'",
        '',
        'export const read = jobs',
        '',
      ].join('\n'),
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(foreignJobs('src/modules/capture/CapturePanel.tsx'))
  })

  it.each([
    ['a bare import', "import '../job/job.schema'", '[opaque-state-import]'],
    ['a multiline named import', "import {\n  jobs,\n} from '../job/job.schema'\nexport const read = jobs", '[foreign-owner-table-access]'],
    ['a star re-export', "export * from '../job/job.schema'", '[opaque-state-import]'],
    ['a type-only re-export', "export type { jobs } from '../job/job.schema'", '[foreign-owner-table-access]'],
  ])('sees %s written after JSX', (_label, tail, rule) => {
    const result = check({
      ...passingFixture(),
      'src/modules/capture/CapturePanel.tsx': [
        'export function CapturePanel({ open }: { open: boolean }) {',
        '  return open ? <section aria-label="c">{String(open)}</section> : <br />',
        '}',
        '',
        tail,
        '',
      ].join('\n'),
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(rule)
    expect(result.stderr).toContain('src/modules/capture/CapturePanel.tsx')
  })

  it('reads edges out of a TSX module whose body has no ES module grammar', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/JobPanel.tsx': [
        "import { readJobs } from '../capture/capture.service'",
        '',
        'export function JobPanel({ open }: { open: boolean }) {',
        '  return open ? <section aria-label="jobs">{readJobs()}</section> : <span>none</span>',
        '}',
        '',
      ].join('\n'),
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[undeclared-module-edge] src/modules/job/JobPanel.tsx imports src/modules/capture/capture.service.ts; module edge job -> capture is not declared in architecture/module-graph.json\n',
    )
  })

  it('refuses a file it cannot parse instead of reading part of it', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/job.broken.ts': "import { jobs from '../job.schema'\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[unlexable-module-source] src/modules/job/job.broken.ts')
  })
})

describe('stable permissions', () => {
  it('accepts a canonical aggregate and registrar recorded member by member', () => {
    const result = check(aggregateFixture())

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it.each([
    [
      'schema-composition claimed off the canonical aggregate',
      { purpose: 'schema-composition', source: 'src/modules/capture/capture.service.ts' },
      'only src/db/schema.ts composes the canonical schema',
    ],
    [
      'schema-registration claimed by another file',
      {
        purpose: 'schema-registration',
        source: 'src/modules/capture/capture.service.ts',
        target: 'src/db/schema.ts',
      },
      'only src/db/pglite.ts registers the canonical schema',
    ],
    [
      'schema-registration pointed at a schema slice',
      { purpose: 'schema-registration', source: 'src/db/pglite.ts' },
      'registration reads src/db/schema.ts, not src/modules/job/job.schema.ts',
    ],
    [
      'foreign-key-reference claimed by a service file',
      { purpose: 'foreign-key-reference', source: 'src/modules/capture/capture.service.ts' },
      'only a schema file declares a foreign-key column',
    ],
    [
      'platform-ownership-root claimed for a capability table',
      { purpose: 'platform-ownership-root', source: 'src/db/pglite.ts' },
      'jobs is owned by capability owner job',
    ],
    [
      'test-state-access claimed on a production service path',
      { purpose: 'test-state-access', source: 'src/modules/capture/capture.service.ts' },
      'a test purpose may only be claimed by a maintained test or test-support path',
    ],
    [
      'test-state-access claimed on a production runtime path',
      { purpose: 'test-state-access', source: 'src/runtime/runtime.ts' },
      'a test purpose may only be claimed by a maintained test or test-support path',
    ],
  ])('rejects %s', (_label, overrides, expected) => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      manifest.permissions = [permission(overrides)]
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[misplaced-architecture-permission]')
    expect(result.stderr).toContain(expected)
  })

  it('rejects a permission naming a purpose the check does not define', () => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      manifest.permissions = [permission({ purpose: 'because-i-said-so' })]
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[broadened-architecture-permission] architecture/module-graph.json permission because-i-said-so src/db/schema.ts -> src/modules/job/job.schema.ts names purpose because-i-said-so, which this check does not define\n',
    )
  })

  it.each([
    ['a directory', { source: 'src/db' }, 'is not an exact repository file'],
    ['a glob', { source: 'src/db/*.ts' }, 'uses a pattern for source'],
  ])('rejects a permission broadened to %s', (_label, overrides, expected) => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      manifest.permissions = [permission(overrides)]
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[broadened-architecture-permission]')
    expect(result.stderr).toContain(expected)
  })

  it('rejects a permission that drops the table it covers', () => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      const { table: _table, ...withoutTable } = permission({})
      manifest.permissions = [withoutTable]
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[broadened-architecture-permission] architecture/module-graph.json entry schema-composition src/db/schema.ts -> src/modules/job/job.schema.ts must carry exactly owner, purpose, reason, recordedIn, source, table, target\n',
    )
  })

  it('rejects a permission that carries a retiring issue', () => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      manifest.permissions = [{ ...permission({}), retiredBy: '#328' }]
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[broadened-architecture-permission]')
  })

  it('rejects an unstamped permission', () => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      manifest.permissions = [permission({ recordedIn: '#999' })]
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[unstamped-architecture-permission] architecture/module-graph.json permission schema-composition src/db/schema.ts -> src/modules/job/job.schema.ts is not stamped by a declared issue reference\n',
    )
  })

  it('rejects a stale permission', () => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      manifest.permissions = [permission({})]
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[stale-architecture-permission] architecture/module-graph.json permission schema-composition src/db/schema.ts -> src/modules/job/job.schema.ts for jobs matches no maintained import\n',
    )
  })
})

describe('aggregate transformation attribution', () => {
  const consumerReads = (producer, exported) => ({
    'src/modules/job/job.producer.ts': producer,
    'src/modules/capture/capture.read.ts':
      `import { ${exported} } from '../job/job.producer'\n\nexport const value = ${exported}\n`,
  })

  it.each([
    [
      'a spread of an inner aggregate',
      "import { jobs } from './job.schema'\n\nconst inner = { postings: jobs }\nexport const outer = { ...inner }\n",
      'outer',
    ],
    [
      'a computed key with a literal name',
      "import { jobs } from './job.schema'\n\nexport const outer = { ['postings']: jobs }\n",
      'outer',
    ],
    [
      'a computed key with an unreadable name',
      "import { jobs } from './job.schema'\n\nconst key = 'postings'\nexport const outer = { [key]: jobs }\n",
      'outer',
    ],
    [
      'a nested aggregate',
      "import { jobs } from './job.schema'\n\nexport const outer = { group: { postings: jobs } }\n",
      'outer',
    ],
    [
      'a destructuring alias',
      "import { jobs } from './job.schema'\n\nconst schema = { postings: jobs }\nexport const { postings: roles } = schema\n",
      'roles',
    ],
    [
      'a member-derived alias',
      "import { jobs } from './job.schema'\n\nconst schema = { postings: jobs }\nexport const roles = schema.postings\n",
      'roles',
    ],
    [
      'an imported alias re-bound locally',
      "import { jobs as postings } from './job.schema'\n\nexport const roles = postings\n",
      'roles',
    ],
    [
      'a spread of a nested aggregate through two hops',
      "import { jobs } from './job.schema'\n\nconst first = { postings: jobs }\nconst second = { ...first }\nexport const outer = { ...second }\n",
      'outer',
    ],
  ])('attributes jobs through %s', (_label, producer, exported) => {
    const result = check({ ...passingFixture(), ...consumerReads(producer, exported) })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(foreignJobs('src/modules/capture/capture.read.ts'))
  })

  it('still records the import when a producer wraps a table at runtime', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/capture/capture.read.ts':
        "import { jobs } from '../job/job.schema'\n\nexport const getSchema = () => jobs\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(foreignJobs('src/modules/capture/capture.read.ts'))
  })
})

describe('table constructor identity', () => {
  const declare = (source) => ({ ...passingFixture(), 'src/modules/job/job.rogue.ts': source })

  it.each([
    [
      'a named import alias',
      "import { pgTable as table } from 'drizzle-orm/pg-core'\n\nexport const rogue = table('rogue', {})\n",
    ],
    [
      'a namespace member',
      "import * as pg from 'drizzle-orm/pg-core'\n\nexport const rogue = pg.pgTable('rogue', {})\n",
    ],
    [
      'a local alias',
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nconst define = pgTable\nexport const rogue = define('rogue', {})\n",
    ],
    [
      'a multi-hop local alias',
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nconst define = pgTable\nconst again = define\nexport const rogue = again('rogue', {})\n",
    ],
    [
      'a namespace member alias',
      "import * as pg from 'drizzle-orm/pg-core'\n\nconst define = pg.pgTable\nexport const rogue = define('rogue', {})\n",
    ],
  ])('discovers a table declared through %s', (_label, source) => {
    const result = check(declare(source))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[unowned-state] src/modules/job/job.rogue.ts exports rogue as rogue without a matching entry in architecture/state-ownership.json\n',
    )
  })

  it.each([
    [
      'a wrapper function',
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nconst define = (name) => pgTable(name, {})\nexport const rogue = define('rogue')\n",
    ],
    [
      'computed namespace access',
      "import * as pg from 'drizzle-orm/pg-core'\n\nconst key = 'pgTable'\nexport const rogue = pg[key]('rogue', {})\n",
    ],
    [
      'a non-literal table name',
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nconst name = 'rogue'\nexport const rogue = pgTable(name, {})\n",
    ],
  ])('refuses a table constructor derived through %s', (_label, source) => {
    const result = check(declare(source))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[opaque-table-declaration] src/modules/job/job.rogue.ts')
  })

  it('leaves an unrelated local function named pgTable alone', () => {
    const result = check(declare(
      'function pgTable(_name, _columns) { return { local: true } }\n\nexport const notATable = pgTable("unrelated", {})\n',
    ))

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })
})

describe('table constructor termination', () => {
  const declare = (source) => ({ ...passingFixture(), 'src/modules/job/job.rogue.ts': source })

  it.each([
    [
      'namespace destructuring',
      "import * as pg from 'drizzle-orm/pg-core'\n\nconst { pgTable: define } = pg\nexport const rogue = define('rogue', {})\n",
    ],
    [
      'multi-hop namespace destructuring',
      "import * as pg from 'drizzle-orm/pg-core'\n\nconst { pgTable: first } = pg\nconst second = first\nexport const rogue = second('rogue', {})\n",
    ],
  ])('discovers a table declared through %s', (_label, source) => {
    const result = check(declare(source))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[unowned-state] src/modules/job/job.rogue.ts exports rogue as rogue without a matching entry in architecture/state-ownership.json\n',
    )
  })

  it.each([
    [
      'a re-export of the constructor',
      "export { pgTable } from 'drizzle-orm/pg-core'\n",
    ],
    [
      'a local re-export of an aliased constructor',
      "import { pgTable as define } from 'drizzle-orm/pg-core'\n\nexport { define }\n",
    ],
    [
      'object storage then a member call',
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nconst kit = { make: pgTable }\nexport const rogue = kit.make('rogue', {})\n",
    ],
    [
      'array storage',
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nconst kit = [pgTable]\nexport const rogue = kit[0]('rogue', {})\n",
    ],
    [
      'an optional call',
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nexport const rogue = pgTable?.('rogue', {})\n",
    ],
    [
      'call',
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nexport const rogue = pgTable.call(null, 'rogue', {})\n",
    ],
    [
      'apply',
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nexport const rogue = pgTable.apply(null, ['rogue', {}])\n",
    ],
    [
      'bind',
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nconst bound = pgTable.bind(null)\nexport const rogue = bound('rogue', {})\n",
    ],
  ])('refuses the constructor transported through %s', (_label, source) => {
    const result = check(declare(source))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[opaque-table-declaration] src/modules/job/job.rogue.ts')
  })
})

describe('assignment and nested destructuring', () => {
  const consumer = {
    'src/modules/capture/capture.read.ts':
      "import { roles } from '../job/job.producer'\n\nexport const value = 1\nvoid roles\n",
  }

  it.each([
    [
      'nested declaration destructuring',
      "import { jobs } from './job.schema'\n\nconst schema = { group: { postings: jobs } }\nexport const { group: { postings: roles } } = schema",
    ],
  ])('attributes jobs through %s', (_label, producer) => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/job.producer.ts': `${producer}\n`,
      ...consumer,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(foreignJobs('src/modules/capture/capture.read.ts'))
  })

  it('records the import when an aggregate member is destructured into an array', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/job.producer.ts':
        "import { jobs } from './job.schema'\n\nconst bag = [jobs]\nexport const [roles] = bag\n",
    })

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })
})

describe('duplicate declarations', () => {
  const schema = (table) =>
    `import { pgTable } from 'drizzle-orm/pg-core'\n\nexport const ${table} = pgTable('${table}', {})\n`

  it('rejects the same physical table declared in two modules, naming both', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/capture/capture.extra.schema.ts':
        "import { pgTable } from 'drizzle-orm/pg-core'\n\nexport const jobsAgain = pgTable('jobs', {})\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[duplicate-state-declaration] physical table jobs is declared 2 times, at src/modules/capture/capture.extra.schema.ts:jobsAgain and src/modules/job/job.schema.ts:jobs; one table has one declaration and one owner\n',
    )
  })

  it('rejects the same physical table declared twice in one module', () => {
    const files = passingFixture()
    const result = check({
      ...files,
      'src/modules/job/job.schema.ts':
        `${files['src/modules/job/job.schema.ts']}export const jobsAgain = pgTable('jobs', {})\n`,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[duplicate-state-declaration] physical table jobs is declared 2 times')
    expect(result.stderr).toContain('src/modules/job/job.schema.ts:jobs')
    expect(result.stderr).toContain('src/modules/job/job.schema.ts:jobsAgain')
  })

  it('reports a duplicate deterministically, with both sites sorted', () => {
    const files = {
      ...passingFixture(),
      'src/modules/capture/capture.extra.schema.ts':
        "import { pgTable } from 'drizzle-orm/pg-core'\n\nexport const jobsAgain = pgTable('jobs', {})\n",
    }
    const root = writeFixture(files, fixtureRoots)

    const first = runArchitectureCheck(root)
    const second = runArchitectureCheck(root)

    expect(first.stderr).toBe(second.stderr)
    expect(first.stderr.indexOf('capture.extra.schema.ts:jobsAgain'))
      .toBeLessThan(first.stderr.indexOf('job.schema.ts:jobs and') + first.stderr.length)
  })

  it('accepts two distinct tables sharing an export name in distinct modules', () => {
    const result = check(withStateOwnership({
      ...passingFixture(),
      'src/modules/capture/capture.alpha.schema.ts': schema('alpha'),
      'src/modules/job/job.beta.schema.ts': schema('beta'),
    }, (manifest) => {
      manifest.schemaModules.push(
        'src/modules/capture/capture.alpha.schema.ts',
        'src/modules/job/job.beta.schema.ts',
      )
      manifest.tables.alpha = {
        owner: 'capture',
        schemaExport: 'alpha',
        schemaModule: 'src/modules/capture/capture.alpha.schema.ts',
      }
      manifest.tables.beta = {
        owner: 'job',
        schemaExport: 'beta',
        schemaModule: 'src/modules/job/job.beta.schema.ts',
      }
    }))

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('rejects a manifest entry whose module or export no longer matches', () => {
    const result = check(withStateOwnership(passingFixture(), (manifest) => {
      manifest.tables.jobs.schemaExport = 'jobsRenamed'
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[stale-state-ownership]')
    expect(result.stderr).toContain('[unowned-state]')
  })
})

describe('assignment-destructured constructor', () => {
  const declare = (source) => ({ ...passingFixture(), 'src/modules/job/job.rogue.ts': source })

  it.each([
    [
      'later assignment destructuring',
      "import * as pg from 'drizzle-orm/pg-core'\n\nlet define\n;({ pgTable: define } = pg)\nexport const rogue = define('rogue', {})\n",
    ],
    [
      'nested later assignment destructuring',
      "import * as pg from 'drizzle-orm/pg-core'\n\nlet define\n;({ core: { pgTable: define } } = pg)\nexport const rogue = define('rogue', {})\n",
    ],
    [
      'later assignment then a multi-hop alias',
      "import * as pg from 'drizzle-orm/pg-core'\n\nlet first\n;({ pgTable: first } = pg)\nconst second = first\nexport const rogue = second('rogue', {})\n",
    ],
    [
      'a defaulted destructuring binding',
      "import * as pg from 'drizzle-orm/pg-core'\n\nconst { pgTable: define = undefined } = pg\nexport const rogue = define('rogue', {})\n",
    ],
  ])('discovers a table declared through %s', (_label, source) => {
    const result = check(declare(source))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[unowned-state] src/modules/job/job.rogue.ts exports rogue as rogue without a matching entry in architecture/state-ownership.json\n',
    )
  })

  it('keeps refusing a constructor transported after an assignment binding', () => {
    const result = check(declare(
      "import * as pg from 'drizzle-orm/pg-core'\n\nlet define\n;({ pgTable: define } = pg)\nconst kit = { make: define }\nexport const rogue = kit.make('rogue', {})\n",
    ))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[opaque-table-declaration] src/modules/job/job.rogue.ts')
  })

  it('leaves an unrelated local helper named pgTable alone', () => {
    const result = check(declare(
      'function pgTable(_name, _columns) { return { local: true } }\n\nexport const notATable = pgTable("unrelated", {})\n',
    ))

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })
})

describe('namespace transport', () => {
  const declare = (source) => ({ ...passingFixture(), 'src/modules/job/job.rogue.ts': source })
  const NS = "import * as pg from 'drizzle-orm/pg-core'\n\n"

  it.each([
    ['a local alias', `${NS}const core = pg\nexport const rogue = core.pgTable('rogue', {})\n`],
    ['a multi-hop alias', `${NS}const core = pg\nconst again = core\nexport const rogue = again.pgTable('rogue', {})\n`],
    ['a named export barrel', `${NS}export { pg }\n`],
    ['a renamed export barrel', `${NS}export { pg as core }\n`],
    ['a re-export barrel', "export * from 'drizzle-orm/pg-core'\n"],
    ['a named constructor re-export', "export { pgTable } from 'drizzle-orm/pg-core'\n"],
    ['a default export', `${NS}export default pg\n`],
    ['object storage', `${NS}const kit = { core: pg }\nexport const rogue = kit.core.pgTable('rogue', {})\n`],
    ['array storage', `${NS}const kit = [pg]\nexport const rogue = kit[0].pgTable('rogue', {})\n`],
    ['a function return', `${NS}export const core = () => pg\n`],
    ['a later assignment', `${NS}let core\ncore = pg\nexport const rogue = core.pgTable('rogue', {})\n`],
  ])('refuses the pg-core namespace transported through %s', (_label, source) => {
    const result = check(declare(source))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[opaque-table-declaration] src/modules/job/job.rogue.ts')
  })

  it('still discovers a direct namespace constructor call', () => {
    const result = check(declare(`${NS}export const rogue = pg.pgTable('rogue', {})\n`))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[unowned-state] src/modules/job/job.rogue.ts exports rogue as rogue without a matching entry in architecture/state-ownership.json\n',
    )
    expect(result.stderr).not.toContain('[opaque-table-declaration]')
  })

  it('still allows other members of the namespace', () => {
    const result = check(declare(`${NS}export const column = pg.text('c')\n`))

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it.each([
    ['declaration destructuring', `${NS}const { pgTable: define } = pg\nexport const rogue = define('rogue', {})\n`],
    ['assignment destructuring', `${NS}let define\n;({ pgTable: define } = pg)\nexport const rogue = define('rogue', {})\n`],
  ])('still follows the constructor out of the namespace by %s', (_label, source) => {
    const result = check(declare(source))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[unowned-state] src/modules/job/job.rogue.ts')
    expect(result.stderr).not.toContain('[opaque-table-declaration]')
  })

  it.each([
    ['an unrelated namespace alias', "import * as util from 'node:util'\n\nconst core = util\nexport const shown = core.format('x')\n"],
    ['an unrelated namespace export', "import * as util from 'node:util'\n\nexport { util }\n"],
    ['an unrelated star re-export', "export * from 'node:util'\n"],
  ])('leaves %s alone', (_label, source) => {
    const result = check(declare(source))

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })
})

describe('one exact access, one policy entry', () => {
  const duplicateOf = (entry, overrides) => ({
    owner: entry.owner,
    purpose: 'cross-capability-state-access',
    reason: 'Duplicated on purpose so the global exact-access key is proven.',
    recordedIn: '#326',
    source: entry.source,
    table: entry.table,
    target: entry.target,
    ...overrides,
  })
  const expected = (source, target, table, categories) =>
    `[duplicate-architecture-policy-entry] architecture/module-graph.json records ${source} -> ${target} for ${table} 2 times, as ${categories}; one access has exactly one entry\n`

  it('rejects an exception that a permission also claims', () => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      manifest.exceptions.push(transitionalException())
      manifest.permissions.push(duplicateOf(transitionalException()))
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(expected(
      'src/modules/connectors/connector.repository.ts',
      'src/modules/source-execution/source-execution.schema.ts',
      'source_execution_scopes',
      'exception and permission',
    ))
  })

  it('rejects a permission that an exception also claims, whichever order', () => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      const { purpose: _purpose, ...access } = captureAccessesJobs()
      manifest.exceptions.push({ ...access, retiredBy: '#999', rule: 'foreign-owner-table-access' })
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(expected(
      'src/modules/capture/capture.service.ts',
      'src/modules/job/job.schema.ts',
      'jobs',
      'exception and permission',
    ))
  })

  it('rejects a duplicate inside the exception set', () => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      manifest.exceptions.push(transitionalException(), transitionalException())
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(expected(
      'src/modules/connectors/connector.repository.ts',
      'src/modules/source-execution/source-execution.schema.ts',
      'source_execution_scopes',
      'exception and exception',
    ))
  })

  it('rejects a duplicate inside the permission set', () => {
    const result = check(withModuleGraph(passingFixture(), (manifest) => {
      manifest.permissions.push(duplicateOf(captureAccessesJobs()))
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(expected(
      'src/modules/capture/capture.service.ts',
      'src/modules/job/job.schema.ts',
      'jobs',
      'permission and permission',
    ))
  })

  it('accepts two distinct tables for one source and target', () => {
    const result = check(withModuleGraph({
      ...passingFixture(),
      'src/modules/job/job.schema.ts': [
        "import { pgTable } from 'drizzle-orm/pg-core'",
        '',
        "export const jobs = pgTable('jobs', {})",
        "export const captures = pgTable('capture_rows', {})",
        '',
      ].join('\n'),
      'src/modules/capture/capture.service.ts':
        "import { jobs, captures } from '../job/job.schema'\n\nvoid jobs\nvoid captures\nexport const columns = 1\n",
    }, (manifest) => {
      manifest.permissions.push({
        ...captureAccessesJobs(),
        table: 'capture_rows',
        reason: 'A second distinct table for the same source and target is not a duplicate.',
      })
    }, ))

    expect(result.stderr).toContain('[unowned-state]')
    expect(result.stderr).not.toContain('[duplicate-architecture-policy-entry]')
  })
})
