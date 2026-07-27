import { count, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { workspaces } from '../../db/workspaces.schema'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { createPgliteJobService } from '../job/job.service'
import {
  companyHistory,
  jobCompanyAssignmentHistory,
  jobCompanyAssignments,
  workspaceCompanies,
} from './company.schema'
import { createInitialCompanyAssignment } from './company.assignment.service'

const resettableOwner = useResettablePgliteTestOwner()
const WORKSPACE = 'workspace-company-initial-assignment'
const CREATED_AT = '2026-07-23T00:00:00.000Z'
const VALID_FACTS = {
  companyName: 'Northstar Robotics',
  roleTitle: 'Engineer',
  sourceName: 'manual',
  roleKind: 'experienced',
  term: null,
  terms: [],
  timingMode: 'unknown',
  startDate: null,
  endDate: null,
  location: null,
  workMode: 'remote',
  employmentType: 'full_time',
  seniority: 'senior',
  compensation: null,
  postedAt: null,
  destination: null,
}

function monotonicClock() {
  let tick = 0
  return () => new Date(Date.parse(CREATED_AT) + tick++ * 1000)
}

async function setup() {
  const { database } = resettableOwner()
  await database.insert(workspaces).values({
    id: WORKSPACE,
    name: WORKSPACE,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  })
  const now = monotonicClock()
  return {
    database,
    jobs: createPgliteJobService(database, {
      now,
      initialCompanyAssignment: createInitialCompanyAssignment({ now }),
    }),
  }
}

describe('initial Company assignment', () => {
  it('establishes the canonical Company atomically on new Job writes', async () => {
    const { database, jobs } = await setup()
    const input = {
      workspaceId: WORKSPACE,
      facts: { ...VALID_FACTS, companyName: 'New Company', roleTitle: 'New Role' },
      actor: { type: 'user' as const, id: 'user-1' },
      idempotencyKey: 'initial-company-create',
    }

    const first = await jobs.create(input)
    const second = await jobs.create(input)

    expect(first).toMatchObject({ ok: true, created: true })
    expect(second).toMatchObject({ ok: true, created: false })
    expect(await database.select({ value: count() }).from(jobCompanyAssignments))
      .toEqual([{ value: 1 }])
    expect(await database.select({ kind: jobCompanyAssignmentHistory.kind })
      .from(jobCompanyAssignmentHistory))
      .toEqual([{ kind: 'assigned' }])
    expect(await database.select({ value: count() }).from(companyHistory))
      .toEqual([{ value: 1 }])
    expect(await database.select({
      displayName: workspaceCompanies.displayName,
      normalizedDisplayName: workspaceCompanies.normalizedDisplayName,
      status: workspaceCompanies.status,
    }).from(workspaceCompanies)).toEqual([{
      displayName: 'New Company',
      normalizedDisplayName: 'new company',
      status: 'active',
    }])
  })

  it('names the Company from Job facts and falls back when they are unreadable', async () => {
    const { database, jobs } = await setup()
    const created = await jobs.create({
      workspaceId: WORKSPACE,
      facts: { roleTitle: 'Unparseable' },
      actor: { type: 'user' as const, id: 'user-1' },
    })

    expect(created).toMatchObject({ ok: true, created: true })
    if (!created.ok) throw new Error('Unreachable Job creation result.')
    const [assignment] = await database
      .select({ companyId: jobCompanyAssignments.companyId })
      .from(jobCompanyAssignments)
      .where(eq(jobCompanyAssignments.jobId, created.job.id))
    expect(assignment?.companyId).toBe(created.job.id)
    expect(await database.select({ displayName: workspaceCompanies.displayName })
      .from(workspaceCompanies))
      .toEqual([{ displayName: 'Unknown company' }])
  })

  it('leaves an existing assignment untouched', async () => {
    const { database, jobs } = await setup()
    const created = await jobs.create({
      workspaceId: WORKSPACE,
      facts: { ...VALID_FACTS, companyName: 'Only Once' },
      actor: { type: 'user' as const, id: 'user-1' },
    })
    if (!created.ok) throw new Error('Unreachable Job creation result.')

    await createInitialCompanyAssignment({ now: monotonicClock() })
      .establishInitialCompanyOn(database, {
        workspaceId: WORKSPACE,
        jobId: created.job.id,
        facts: { ...VALID_FACTS, companyName: 'Should Not Apply' },
        createdAt: CREATED_AT,
      })

    expect(await database.select({ value: count() }).from(jobCompanyAssignments))
      .toEqual([{ value: 1 }])
    expect(await database.select({ displayName: workspaceCompanies.displayName })
      .from(workspaceCompanies))
      .toEqual([{ displayName: 'Only Once' }])
  })
})
