import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lifecyclePhysicalTableOwnership, lifecycleTableOwnership } from '../db/table-ownership'
import {
  findLifecycleStateOwnershipViolations,
  moduleForPath,
  type OwnershipSourceFile,
} from './lifecycle-state-ownership'

const repositoryRoot = process.cwd()
const maintainedSourcePattern = /\.[cm]?tsx?$/
const testSourcePattern = /\.test\.[cm]?tsx?$/
// Scan all application and package-owned production source, excluding test
// scaffolding and the database declaration layer itself. This closes future
// evasions in code paths outside either composition root.
const productionSourceRoots = ['packages/local-runtime/src', 'src']
const excludedSubtrees = [
  'packages/local-runtime/src/db/',
  'src/test/',
  'src/db/',
  'src/test-fixtures/',
]

function collectProductionSourceFiles(): OwnershipSourceFile[] {
  return productionSourceRoots
    .flatMap((sourceRoot) => fs
      .readdirSync(
        path.join(repositoryRoot, sourceRoot),
        { recursive: true, encoding: 'utf8' },
      )
      .map((entry) => `${sourceRoot}/${String(entry).split(path.sep).join('/')}`))
    .filter((relativePath) => maintainedSourcePattern.test(relativePath) && !testSourcePattern.test(relativePath))
    .filter((relativePath) => !excludedSubtrees.some((subtree) => relativePath.startsWith(subtree)))
    .filter((relativePath) => fs.statSync(path.join(repositoryRoot, relativePath)).isFile())
    .map((relativePath) => ({
      path: relativePath,
      module: moduleForPath(relativePath),
      source: fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8'),
    }))
}

describe('lifecycle state-ownership policy', () => {
  it('assigns exactly one owning module to every lifecycle aggregate', () => {
    const owners = new Set(['capture', 'job', 'opportunity', 'applications', 'connectors', 'scheduling'])
    expect(new Set(Object.values(lifecycleTableOwnership))).toEqual(owners)
    // Per-table correspondence: each identifier maps to its snake_case physical name
    // with the same owner, and the physical map has no extra entries. A same-owner,
    // same-count swap between the two maps cannot slip through.
    const rootPhysicalNames: Record<string, string> = {
      applications: 'applications',
      captures: 'captures',
      jobs: 'jobs',
      opportunities: 'opportunities',
    }
    const camelToSnake = (identifier: string) => rootPhysicalNames[identifier]
      ?? identifier.replace(/([A-Z])/g, '_$1').toLowerCase()
    const expectedPhysical: Record<string, string> = {}
    for (const [identifier, owner] of Object.entries(lifecycleTableOwnership)) {
      expectedPhysical[camelToSnake(identifier)] = owner
    }
    expect(lifecyclePhysicalTableOwnership).toEqual(expectedPhysical)
  })

  it('forbids cross-module writes to lifecycle aggregate state', () => {
    const violations = findLifecycleStateOwnershipViolations(collectProductionSourceFiles())
    expect(violations).toEqual([])
  })

  it('routes every promotion through canonical transaction-owning orchestration', () => {
    const orchestrationPaths = [
      'packages/local-runtime/src/modules/lifecycle/capture-to-job.promotion.ts',
      'packages/local-runtime/src/modules/lifecycle/job-to-opportunity.promotion.ts',
      'packages/local-runtime/src/modules/lifecycle/opportunity-to-application.promotion.ts',
    ]
    const sources = orchestrationPaths.map((orchestrationPath) => ({
      path: orchestrationPath,
      module: 'lifecycle',
      source: fs.readFileSync(path.join(repositoryRoot, orchestrationPath), 'utf8'),
    }))
    for (const { source } of sources) expect(source).toContain('database.transaction(')
    expect(findLifecycleStateOwnershipViolations(sources)).toEqual([])
  })
})
