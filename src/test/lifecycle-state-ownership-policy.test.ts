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
    const owners = new Set(['capture', 'job', 'opportunity', 'applications', 'scheduling'])
    expect(new Set(Object.values(lifecycleTableOwnership))).toEqual(owners)
    // Per-table correspondence: each identifier maps to its snake_case physical name
    // with the same owner, and the physical map has no extra entries. A same-owner,
    // same-count swap between the two maps cannot slip through.
    const camelToSnake = (identifier: string) => identifier.replace(/([A-Z])/g, '_$1').toLowerCase()
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

  it('routes cross-aggregate flows through the single transaction-owning orchestration', () => {
    const orchestrationPath = 'src/modules/sourcing/sourcing.processor.ts'
    const source = fs.readFileSync(path.join(repositoryRoot, orchestrationPath), 'utf8')
    // Owns the transaction boundary for the cross-aggregate (Opportunity -> Application) flow.
    expect(source).toContain('database.transaction(')
    // Composes the owning modules' repositories inside that transaction.
    expect(source).toContain('createPgliteApplicationRepository(transaction)')
    expect(source).toContain('createPgliteScoringRepository(transaction)')
    // Issues no direct lifecycle-table writes of its own (no orchestrator exemption needed).
    const violations = findLifecycleStateOwnershipViolations([
      { path: orchestrationPath, module: 'sourcing', source },
    ])
    expect(violations).toEqual([])
  })
})
