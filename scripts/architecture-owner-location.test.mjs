import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'

import {
  passingFixture,
  runArchitectureCheck,
  withModuleGraph,
  withStateOwnership,
  writeFixture,
} from './architecture-check.fixture.mjs'

/**
 * `misowned-state-location` (issue #328).
 *
 * Every other ownership rule compares the manifest against the tree, so moving a
 * definition and editing its `schemaModule` to match reads as consistent and passes.
 * These fixtures make exactly that edit — the move and the manifest agree — and each
 * one must still fail.
 *
 * The sharp case is a move into another capability rather than out of `src/modules`:
 * the definition lands in a sibling module, a re-export keeps every consumer and
 * policy entry resolving, and the honest module edge is declared. Only a per-owner
 * declaration root catches it.
 */

const CAPABILITY_ROOT = 'src/modules'

/** @type {string[]} */
const fixtureRoots = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) fs.rmSync(root, { recursive: true })
})

/**
 * @param {Record<string, string>} files
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
function check(files) {
  return runArchitectureCheck(writeFixture(files, fixtureRoots))
}

/**
 * The job definition moved back under `src/db`, with the module file left as a
 * re-export so every consumer, edge, and policy entry still resolves. Nothing but
 * the declaration site changed, and the ownership manifest is edited to agree.
 *
 * @returns {Record<string, string>}
 */
function jobsDeclaredUnderDb() {
  return withStateOwnership({
    ...passingFixture(),
    'src/db/job.schema.ts':
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nexport const jobs = pgTable('jobs', {})\n",
    'src/modules/job/job.schema.ts': "export { jobs } from '../../db/job.schema'\n",
  }, (manifest) => {
    manifest.tables.jobs.schemaModule = 'src/db/job.schema.ts'
    manifest.schemaModules = manifest.schemaModules.map((entry) =>
      entry === 'src/modules/job/job.schema.ts' ? 'src/db/job.schema.ts' : entry,
    )
  })
}

/**
 * The same move, but into another capability module rather than out of
 * `src/modules`: `jobs` is declared in the source-execution slice, the job schema
 * keeps handing it out as a re-export, the manifest paths are updated to match, and
 * the `job -> source-execution` edge the move creates is declared honestly.
 *
 * Owner `job` and its module `src/modules/job` are untouched, so nothing here
 * disagrees with anything else.
 *
 * @param {(owners: Record<string, any>) => void} [mutateOwners]
 * @returns {Record<string, string>}
 */
function jobsDeclaredInSourceExecution(mutateOwners) {
  const files = withModuleGraph({
    ...passingFixture(),
    'src/modules/job/job.schema.ts':
      "export { jobs } from '../source-execution/source-execution.schema'\n",
    'src/modules/source-execution/source-execution.schema.ts': [
      "import { pgTable } from 'drizzle-orm/pg-core'",
      '',
      "export const jobs = pgTable('jobs', {})",
      "export const sourceExecutionScopes = pgTable('source_execution_scopes', {})",
      '',
    ].join('\n'),
  }, (manifest) => {
    manifest.edges.push({ from: 'job', recordedIn: '#326', to: 'source-execution' })
  })
  return withStateOwnership(files, (manifest) => {
    manifest.tables.jobs.schemaModule = 'src/modules/source-execution/source-execution.schema.ts'
    manifest.schemaModules = manifest.schemaModules.filter(
      (entry) => entry !== 'src/modules/job/job.schema.ts',
    )
    mutateOwners?.(manifest.owners)
  })
}

describe('owner-location enforcement', () => {
  it('accepts the fixture before the declaration moves', () => {
    const result = check(passingFixture())

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('rejects a capability table declared under src/db, manifest path and all', () => {
    const result = check(jobsDeclaredUnderDb())

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[misowned-state-location] src/db/job.schema.ts declares jobs, owned by capability job, outside its declaration root src/modules/job;',
    )
  })

  it('rejects a capability table declared in another capability behind a re-export', () => {
    const result = check(jobsDeclaredInSourceExecution())

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[misowned-state-location] src/modules/source-execution/source-execution.schema.ts declares jobs, owned by capability job, outside its declaration root src/modules/job; a capability-owned table is declared in its own module, not under src/db and not in another module\n',
    )
  })

  it('rejects claiming the sibling capability as the declaration root to license it', () => {
    const result = check(jobsDeclaredInSourceExecution((owners) => {
      owners.job.declarationModule = 'src/modules/source-execution'
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "[misowned-state-location] architecture/state-ownership.json gives owner job declaration root src/modules/source-execution, which is capability source-execution's module; one capability never declares its state in another's module\n",
    )
  })

  it('rejects broadening the capability module to the whole module root', () => {
    const result = check(jobsDeclaredInSourceExecution((owners) => {
      owners.job.module = CAPABILITY_ROOT
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[misowned-state-location] architecture/state-ownership.json gives capability owner job module src/modules, not its canonical module src/modules/job; a capability module is exactly src/modules/<owner>, the identity the module graph and the cross-capability rules already read\n',
    )
  })

  it.each([
    ['a sibling capability', 'src/modules/source-execution'],
    ['a directory below its own module', 'src/modules/job/nested'],
    ['a path outside the module root', 'src/db'],
  ])('rejects a capability module pointed at %s', (_label, module) => {
    const result = check(jobsDeclaredInSourceExecution((owners) => {
      owners.job.module = module
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `[misowned-state-location] architecture/state-ownership.json gives capability owner job module ${module}, not its canonical module src/modules/job;`,
    )
  })

  it('rejects a capability module whose canonical directory does not exist', () => {
    const result = check(withStateOwnership(passingFixture(), (manifest) => {
      manifest.owners.ghost = { kind: 'capability', module: 'src/modules/ghost' }
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[misowned-state-location] architecture/state-ownership.json gives capability owner ghost module src/modules/ghost, which is not an existing module directory\n',
    )
  })

  it('rejects a platform owner carrying a capability module', () => {
    const result = check(withStateOwnership(platformRootFixture(), (manifest) => {
      manifest.owners['workspace-platform'].module = 'src/modules/job'
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[misowned-state-location] architecture/state-ownership.json gives platform owner workspace-platform module src/modules/job; the platform ownership root has no capability module\n',
    )
  })

  it('rejects a declaration root that publishes its own public surface', () => {
    const result = check(withStateOwnership({
      ...jobsDeclaredInSourceExecution(),
      'src/modules/reporting/public.ts': "export const reporting = 'surface'\n",
    }, (manifest) => {
      manifest.owners.job.declarationModule = 'src/modules/reporting'
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[misowned-state-location] architecture/state-ownership.json gives owner job declaration root src/modules/reporting, which publishes its own public.ts; a declaration root is a declaration-only directory, not another module\n',
    )
  })

  it('rejects a declaration root that is not a module directory', () => {
    const result = check(withStateOwnership(jobsDeclaredUnderDb(), (manifest) => {
      manifest.owners.job.declarationModule = 'src/db'
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[misowned-state-location] architecture/state-ownership.json gives owner job declaration root src/db, which is not a module directory directly under src/modules\n',
    )
  })

  it('rejects a declaration root that only repeats the capability module', () => {
    const result = check(withStateOwnership(passingFixture(), (manifest) => {
      manifest.owners.job.declarationModule = 'src/modules/job'
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[misowned-state-location] architecture/state-ownership.json gives owner job declaration root src/modules/job, which is already its module; drop the redundant declarationModule\n',
    )
  })

  it('rejects two owners sharing one declaration root', () => {
    const result = check(withStateOwnership(sharedDeclarationRoot(), (manifest) => {
      manifest.owners.capture.declarationModule = 'src/modules/job-state'
      manifest.owners.job.declarationModule = 'src/modules/job-state'
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[misowned-state-location] architecture/state-ownership.json gives owners capture and job the same declaration root src/modules/job-state; one declaration root has one owner\n',
    )
  })

  it('rejects a declaration root on a platform owner', () => {
    const result = check(withStateOwnership(platformRootFixture(), (manifest) => {
      manifest.owners['workspace-platform'].declarationModule = 'src/modules/job'
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[misowned-state-location] architecture/state-ownership.json gives platform owner workspace-platform a declarationModule; only a capability declares state inside src/modules\n',
    )
  })

  it('rejects relabelling the owning module platform to license the move', () => {
    const result = check(withStateOwnership(jobsDeclaredUnderDb(), (manifest) => {
      manifest.owners.job = { kind: 'platform', module: null }
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[misowned-state-location] architecture/state-ownership.json declares owner job as platform while src/modules/job is a capability module; a module cannot relabel itself platform to declare state outside src/modules\n',
    )
  })

  it('rejects a platform ownership root declared inside a capability module', () => {
    const result = check(withStateOwnership(passingFixture(), (manifest) => {
      manifest.owners['job-platform'] = { kind: 'platform', module: null }
      manifest.tables.jobs.owner = 'job-platform'
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[misowned-state-location] src/modules/job/job.schema.ts declares jobs, owned by platform job-platform, inside src/modules; the platform ownership root is not declared in a capability module\n',
    )
  })

  it('accepts the platform ownership root declared outside every capability module', () => {
    const result = check(platformRootFixture())

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('accepts a declaration-only sibling named as the declaration root', () => {
    const result = check(withStateOwnership(sharedDeclarationRoot(), (manifest) => {
      manifest.owners.job.declarationModule = 'src/modules/job-state'
    }))

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('rejects the same sibling split when the declaration root is not recorded', () => {
    const result = check(sharedDeclarationRoot())

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[misowned-state-location] src/modules/job-state/job-state.schema.ts declares jobs, owned by capability job, outside its declaration root src/modules/job;',
    )
  })
})

/**
 * The real `applications` shape: a capability whose runtime and public root must stay
 * put while its table declaration lives in a declaration-only sibling directory.
 *
 * @returns {Record<string, string>}
 */
function sharedDeclarationRoot() {
  const files = withModuleGraph({
    ...passingFixture(),
    'src/modules/job-state/job-state.schema.ts':
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nexport const jobs = pgTable('jobs', {})\n",
    'src/modules/job/job.schema.ts': "export { jobs } from '../job-state/job-state.schema'\n",
  }, (manifest) => {
    manifest.edges.push({ from: 'job', recordedIn: '#326', to: 'job-state' })
  })
  return withStateOwnership(files, (manifest) => {
    manifest.tables.jobs.schemaModule = 'src/modules/job-state/job-state.schema.ts'
    manifest.schemaModules = manifest.schemaModules.map((entry) =>
      entry === 'src/modules/job/job.schema.ts' ? 'src/modules/job-state/job-state.schema.ts' : entry,
    )
  })
}

/** @returns {Record<string, string>} */
function platformRootFixture() {
  return withStateOwnership({
    ...passingFixture(),
    'src/db/workspaces.schema.ts':
      "import { pgTable } from 'drizzle-orm/pg-core'\n\nexport const workspaces = pgTable('workspaces', {})\n",
  }, (manifest) => {
    manifest.owners['workspace-platform'] = { kind: 'platform', module: null }
    manifest.schemaModules.push('src/db/workspaces.schema.ts')
    manifest.tables.workspaces = {
      owner: 'workspace-platform',
      schemaExport: 'workspaces',
      schemaModule: 'src/db/workspaces.schema.ts',
    }
  })
}
