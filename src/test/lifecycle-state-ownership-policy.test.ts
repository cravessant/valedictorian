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
// Scan all production source under src/, excluding test files/scaffolding and the
// db layer itself (which defines the tables). This closes future evasions in code
// paths outside src/{modules,runtime,server}.
const excludedSubtrees = ['src/test/', 'src/db/', 'src/test-fixtures/']

function collectProductionSourceFiles(): OwnershipSourceFile[] {
  const sourceRoot = path.join(repositoryRoot, 'src')
  return fs
    .readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' })
    .map((entry) => `src/${String(entry).split(path.sep).join('/')}`)
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
      'src/modules/lifecycle/capture-to-job.promotion.ts',
      'src/modules/lifecycle/job-to-opportunity.promotion.ts',
      'src/modules/lifecycle/opportunity-to-application.promotion.ts',
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
