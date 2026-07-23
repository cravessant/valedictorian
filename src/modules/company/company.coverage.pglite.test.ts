import { asc, count, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { workspaces } from '../../db/workspaces.schema'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { createPgliteJobService } from '../job/job.service'
import { jobs } from '../job/job.schema'
import {
  companyBackfillJournal,
  companyHistory,
  jobCompanyAssignmentHistory,
  jobCompanyAssignments,
  workspaceCompanies,
} from './company.schema'
import { createCompanyCoverageService } from './company.coverage'

const resettableOwner = useResettablePgliteTestOwner()
const WORKSPACE = 'workspace-company-coverage'
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
  return { database, now }
}

async function createExistingJobs(
  database: ReturnType<typeof resettableOwner>['database'],
  now: () => Date,
) {
  const inputs = [
    VALID_FACTS,
    { ...VALID_FACTS, companyName: 'Acme Labs', roleTitle: 'Researcher' },
    { roleTitle: 'Company omitted' },
  ]
  for (const [index, facts] of inputs.entries()) {
    const timestamp = now().toISOString()
    await database.insert(jobs).values({
      id: `018f0000-0000-7000-8000-${String(index + 1).padStart(12, '0')}`,
      workspaceId: WORKSPACE,
      factsRevision: 1,
      factsJson: JSON.stringify(facts),
      availabilityState: 'unknown',
      availabilityObservedAt: timestamp,
      availabilityRevision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null,
      idempotencyKey: `existing-${index}`,
    })
  }
}

describe.sequential('Workspace Company coverage migration', () => {
  it('resumes bounded pages, journals baselines, and converges idempotently', async () => {
    const { database, now } = await setup()
    await createExistingJobs(database, now)
    const firstRun = createCompanyCoverageService(database, { now, pageSize: 2 })

    expect(await firstRun.prepare(WORKSPACE)).toEqual({
      status: 'migrating',
      completed: 0,
      total: 3,
      issueCount: 0,
    })
    expect(await firstRun.backfillNextPage(WORKSPACE)).toBe(2)
    expect(await firstRun.getCapability(WORKSPACE)).toEqual({
      status: 'migrating',
      completed: 2,
      total: 3,
      issueCount: 0,
    })

    const restarted = createCompanyCoverageService(database, { now, pageSize: 2 })
    expect(await restarted.migrateToReady(WORKSPACE)).toEqual({ status: 'ready' })
    expect(await restarted.verify(WORKSPACE)).toEqual({
      ok: true,
      issueCount: 0,
      checks: [],
    })

    const assignments = await database
      .select()
      .from(jobCompanyAssignments)
      .where(eq(jobCompanyAssignments.workspaceId, WORKSPACE))
    const journal = await database
      .select()
      .from(companyBackfillJournal)
      .where(eq(companyBackfillJournal.workspaceId, WORKSPACE))
    const histories = await database
      .select()
      .from(jobCompanyAssignmentHistory)
      .where(eq(jobCompanyAssignmentHistory.workspaceId, WORKSPACE))
    const companies = await database
      .select()
      .from(workspaceCompanies)
      .where(eq(workspaceCompanies.workspaceId, WORKSPACE))

    expect(assignments).toHaveLength(3)
    expect(journal).toHaveLength(3)
    expect(histories.map((entry) => entry.kind)).toEqual([
      'baseline',
      'baseline',
      'baseline',
    ])
    expect(companies.map((company) => company.displayName)).toContain('Unknown company')
    expect(journal.filter((entry) => entry.usedUnknownName === 1)).toHaveLength(1)

    expect(await restarted.migrateToReady(WORKSPACE)).toEqual({ status: 'ready' })
    expect(await database.select({ value: count() }).from(workspaceCompanies))
      .toEqual([{ value: 3 }])
  })

  it('creates assignment coverage atomically on new Job writes', async () => {
    const { database, now } = await setup()
    const coverage = createCompanyCoverageService(database, { now })
    await coverage.prepare(WORKSPACE)
    const jobs = createPgliteJobService(database, {
      now,
      creationCoverage: coverage.jobCreationCoverage,
    })
    const input = {
      workspaceId: WORKSPACE,
      facts: { ...VALID_FACTS, companyName: 'New Company', roleTitle: 'New Role' },
      actor: { type: 'user' as const, id: 'user-1' },
      idempotencyKey: 'covered-create',
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
  })

  it('blocks with bounded information when coverage integrity fails', async () => {
    const { database, now } = await setup()
    await createExistingJobs(database, now)
    const coverage = createCompanyCoverageService(database, { now })
    expect(await coverage.migrateToReady(WORKSPACE)).toEqual({ status: 'ready' })
    const [history] = await database
      .select({ id: jobCompanyAssignmentHistory.id })
      .from(jobCompanyAssignmentHistory)
      .limit(1)
    if (!history) throw new Error('expected assignment history')
    await database.delete(jobCompanyAssignmentHistory)
      .where(eq(jobCompanyAssignmentHistory.id, history.id))

    expect(await coverage.migrateToReady(WORKSPACE)).toEqual({
      status: 'blocked',
      issueCount: 2,
      reason: 'integrity_check_failed',
      message: 'Workspace Company coverage verification failed.',
      remediation: null,
    })
    expect(await coverage.migrateToReady(WORKSPACE)).toMatchObject({
      status: 'blocked',
      remediation: null,
    })
  })

  it('rejects an assignment whose merged target is not terminal', async () => {
    const { database, now } = await setup()
    await createExistingJobs(database, now)
    const coverage = createCompanyCoverageService(database, { now })
    expect(await coverage.migrateToReady(WORKSPACE)).toEqual({ status: 'ready' })
    const companies = await database
      .select({ id: workspaceCompanies.id })
      .from(workspaceCompanies)
      .orderBy(asc(workspaceCompanies.createdAt), asc(workspaceCompanies.id))
    if (companies.length !== 3) throw new Error('expected three baseline Companies')

    await database.update(workspaceCompanies).set({
      status: 'merged',
      mergedIntoCompanyId: companies[2]!.id,
    }).where(eq(workspaceCompanies.id, companies[1]!.id))
    await database.update(workspaceCompanies).set({
      status: 'merged',
      mergedIntoCompanyId: companies[1]!.id,
    }).where(eq(workspaceCompanies.id, companies[0]!.id))

    expect(await coverage.verify(WORKSPACE)).toEqual({
      ok: false,
      issueCount: 1,
      checks: ['merged_target'],
    })
  })

  it('rejects assignment history owned by another workspace and Company', async () => {
    const { database, now } = await setup()
    await createExistingJobs(database, now)
    const coverage = createCompanyCoverageService(database, { now })
    expect(await coverage.migrateToReady(WORKSPACE)).toEqual({ status: 'ready' })
    const foreignWorkspace = 'workspace-company-foreign-history'
    const foreignCompany = '018f0000-0000-7000-8000-000000000099'
    await database.insert(workspaces).values({
      id: foreignWorkspace,
      name: foreignWorkspace,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    await database.insert(workspaceCompanies).values({
      id: foreignCompany,
      workspaceId: foreignWorkspace,
      displayName: 'Foreign Company',
      normalizedDisplayName: 'foreign company',
      websiteUrl: null,
      websiteHost: null,
      notes: null,
      revision: 1,
      status: 'active',
      mergedIntoCompanyId: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    const [history] = await database
      .select({ id: jobCompanyAssignmentHistory.id })
      .from(jobCompanyAssignmentHistory)
      .limit(1)
    if (!history) throw new Error('expected assignment history')
    await database.update(jobCompanyAssignmentHistory).set({
      workspaceId: foreignWorkspace,
      companyId: foreignCompany,
    }).where(eq(jobCompanyAssignmentHistory.id, history.id))

    expect(await coverage.verify(WORKSPACE)).toEqual({
      ok: false,
      issueCount: 2,
      checks: ['assignment_history', 'baseline_history'],
    })
  })
})
