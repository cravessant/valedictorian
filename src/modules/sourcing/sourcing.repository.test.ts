import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  applicationEvents,
  applicationLinks,
  applicationScores,
  applications,
  sourcingFindings,
} from '../../db/schema'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { seedSampleApplications } from '../applications/application.fixtures'
import { createSqlitePolicyRepository } from '../policy/policy.repository'
import { createSqliteWorkflowRunRepository } from '../workflow-runs/workflow-run.repository'
import { createSqliteSourcingRepository } from './sourcing.repository'

describe('SQLite sourcing repository', () => {
  it('reclassifies sourcing findings after create and update patches', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    const runRepository = createSqliteWorkflowRunRepository(database)
    const sourcingRepository = createSqliteSourcingRepository(database)
    const run = await runRepository.startRun({
      runType: 'sourcing',
      actorType: 'agent',
      sourceName: 'LinkedIn',
      summary: 'Started LinkedIn sourcing.',
    })

    const blocked = await sourcingRepository.createFinding({
      workflowRunId: run.id,
      sourceName: 'LinkedIn',
      companyName: 'Human Labs',
      roleTitle: 'Frontend Engineering Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
    })

    expect(blocked).toMatchObject({
      blocker: expect.stringContaining('officialUrl or sourceUrl'),
      mergeStatus: 'blocked',
      mergeNotes: expect.stringContaining('officialUrl or sourceUrl'),
      mergedApplicationId: null,
    })

    const reclassifiedNew = await sourcingRepository.updateFinding({
      findingId: blocked.id,
      sourceUrl:
        'https://linkedin.com/jobs/view/human-labs-frontend?currentJobId=123&trackingId=abc&utm_source=agent',
    })

    expect(reclassifiedNew).toMatchObject({
      blocker: null,
      duplicateNotes: null,
      mergeStatus: 'new',
      mergeNotes: null,
      sourceUrl:
        'https://linkedin.com/jobs/view/human-labs-frontend?currentJobId=123&trackingId=abc&utm_source=agent',
    })

    const duplicate = await sourcingRepository.updateFinding({
      findingId: blocked.id,
      officialUrl:
        'https://jobs.example.test/remediated/41581ba03bdcb93e?utm_source=linkedin',
    })

    expect(duplicate).toMatchObject({
      duplicateNotes: expect.stringContaining('Duplicate official URL'),
      mergeStatus: 'duplicate',
      mergedApplicationId: 'application-versant-platform',
      mergeNotes: expect.stringContaining('Duplicate official URL'),
      officialUrl: 'https://jobs.example.test/remediated/41581ba03bdcb93e',
    })

    const belowCutoff = await sourcingRepository.updateFinding({
      findingId: blocked.id,
      officialUrl: 'https://jobs.example.com/human-labs/frontend',
      priorityBand: 'skip',
      priorityScore: 4,
    })

    expect(belowCutoff).toMatchObject({
      duplicateNotes: null,
      mergeStatus: 'below_cutoff',
      mergedApplicationId: null,
      mergeNotes: 'Priority score 4 is below policy cutoff 6.',
      priorityScore: 4,
    })
  })

  it('reclassifies before promotion and does not promote ineligible findings', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    const runRepository = createSqliteWorkflowRunRepository(database)
    const sourcingRepository = createSqliteSourcingRepository(database)
    const run = await runRepository.startRun({
      runType: 'sourcing',
      actorType: 'agent',
      sourceName: 'LinkedIn',
      summary: 'Started LinkedIn sourcing.',
    })
    const finding = await sourcingRepository.createFinding({
      workflowRunId: run.id,
      sourceName: 'LinkedIn',
      companyName: 'Northstar Robotics',
      roleTitle: 'Automation Analyst Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'hybrid',
      officialUrl: 'https://jobs.example.com/northstar/automation-analyst-intern',
      priorityScore: 4,
      priorityBand: 'skip',
    })
    const applicationCount = database.select().from(applications).all().length

    const promoted = await sourcingRepository.promoteFinding({ findingId: finding.id })

    expect(promoted).toMatchObject({
      mergeStatus: 'below_cutoff',
      mergedApplicationId: null,
    })
    expect(database.select().from(applications).all()).toHaveLength(applicationCount)
  })

  it('uses policy cutoff overrides and apply override evidence for promotion', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    const policyRepository = createSqlitePolicyRepository(database)
    await policyRepository.updateConfig({
      scoring: {
        applyCutoff: 7,
      },
    })
    const runRepository = createSqliteWorkflowRunRepository(database)
    const sourcingRepository = createSqliteSourcingRepository(database)
    const run = await runRepository.startRun({
      runType: 'sourcing',
      actorType: 'agent',
      sourceName: 'LinkedIn',
      summary: 'Started LinkedIn sourcing.',
    })
    const finding = await sourcingRepository.createFinding({
      workflowRunId: run.id,
      sourceName: 'LinkedIn',
      companyName: 'Override Labs',
      roleTitle: 'Software Engineering Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      officialUrl: 'https://jobs.example.com/override-labs/swe-intern',
      priorityScore: 6,
      priorityBand: 'medium',
    })

    expect(finding).toMatchObject({
      mergeStatus: 'below_cutoff',
      mergeNotes: 'Priority score 6 is below policy cutoff 7.',
    })

    await policyRepository.recordEvidence({
      subjectType: 'sourcing_finding',
      subjectId: finding.id,
      tag: 'apply_cutoff_override',
      source: 'user',
      note: 'User explicitly wants this role pursued.',
    })
    const promoted = await sourcingRepository.promoteFinding({ findingId: finding.id })

    expect(promoted).toMatchObject({
      mergeStatus: 'merged',
      mergedApplicationId: expect.any(String),
    })
  })

  it('keeps explicit manual dispositions while normal patches update finding data', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const runRepository = createSqliteWorkflowRunRepository(database)
    const sourcingRepository = createSqliteSourcingRepository(database)
    const run = await runRepository.startRun({
      runType: 'sourcing',
      actorType: 'agent',
      sourceName: 'LinkedIn',
      summary: 'Started LinkedIn sourcing.',
    })
    const finding = await sourcingRepository.createFinding({
      workflowRunId: run.id,
      sourceName: 'LinkedIn',
      companyName: 'Aster Systems',
      roleTitle: 'Product Engineering Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      sourceUrl: 'https://linkedin.com/jobs/view/aster-product-engineering',
      priorityScore: 8,
      priorityBand: 'high',
    })

    const decided = await sourcingRepository.decideFinding({
      findingId: finding.id,
      mergeStatus: 'not_fit',
      mergeNotes: 'Requires a non-student schedule.',
      dispositionReason: 'Requires a non-student schedule.',
    })

    expect(decided).toMatchObject({
      dispositionReason: 'Requires a non-student schedule.',
      mergeStatus: 'not_fit',
      mergeNotes: 'Requires a non-student schedule.',
      mergedApplicationId: null,
    })

    const reclassified = await sourcingRepository.updateFinding({
      findingId: finding.id,
      fitNotes: 'Reconsidered after schedule clarification.',
    })

    expect(reclassified).toMatchObject({
      fitNotes: 'Reconsidered after schedule clarification.',
      dispositionReason: 'Requires a non-student schedule.',
      mergeStatus: 'not_fit',
      mergeNotes: 'Requires a non-student schedule.',
    })

    const blocked = await sourcingRepository.decideFinding({
      findingId: finding.id,
      mergeStatus: 'blocked',
      mergeNotes: 'Needs user decision on sponsorship.',
      policyBlocker: 'needs_user_decision',
    })

    expect(blocked).toMatchObject({
      dispositionReason: 'Needs user decision on sponsorship.',
      mergeStatus: 'blocked',
      policyBlocker: 'needs_user_decision',
    })
  })

  it('does not demote or unlink already merged findings during normal data patches', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const runRepository = createSqliteWorkflowRunRepository(database)
    const sourcingRepository = createSqliteSourcingRepository(database)
    const run = await runRepository.startRun({
      runType: 'sourcing',
      actorType: 'agent',
      sourceName: 'LinkedIn',
      summary: 'Started LinkedIn sourcing.',
    })
    const finding = await sourcingRepository.createFinding({
      workflowRunId: run.id,
      sourceName: 'LinkedIn',
      companyName: 'Solace Robotics',
      roleTitle: 'Controls Engineering Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'hybrid',
      sourceUrl: 'https://linkedin.com/jobs/view/solace-controls',
      priorityScore: 8,
      priorityBand: 'high',
    })
    const promoted = await sourcingRepository.promoteFinding({ findingId: finding.id })

    const updated = await sourcingRepository.updateFinding({
      findingId: finding.id,
      fitNotes: 'Human edit after promotion.',
      priorityScore: 4,
    })

    expect(updated).toMatchObject({
      fitNotes: 'Human edit after promotion.',
      mergeStatus: 'merged',
      mergedApplicationId: promoted.mergedApplicationId,
    })
  })

  it('rejects manually writing merged status through create and update paths', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const runRepository = createSqliteWorkflowRunRepository(database)
    const sourcingRepository = createSqliteSourcingRepository(database)
    const run = await runRepository.startRun({
      runType: 'sourcing',
      actorType: 'agent',
      sourceName: 'LinkedIn',
      summary: 'Started LinkedIn sourcing.',
    })

    await expect(
      sourcingRepository.createFinding({
        workflowRunId: run.id,
        sourceName: 'LinkedIn',
        companyName: 'Manual Merge Labs',
        roleTitle: 'Software Engineering Intern',
        roleKind: 'internship',
        country: 'US',
        workMode: 'remote',
        sourceUrl: 'https://linkedin.com/jobs/view/manual-merge-labs',
        priorityScore: 8,
        priorityBand: 'high',
        mergeStatus: 'merged' as never,
      }),
    ).rejects.toThrow('Sourcing findings can only be marked merged by promotion.')

    const finding = await sourcingRepository.createFinding({
      workflowRunId: run.id,
      sourceName: 'LinkedIn',
      companyName: 'Manual Merge Labs',
      roleTitle: 'Software Engineering Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      sourceUrl: 'https://linkedin.com/jobs/view/manual-merge-labs',
      priorityScore: 8,
      priorityBand: 'high',
    })

    await expect(
      sourcingRepository.updateFinding({
        findingId: finding.id,
        mergeStatus: 'merged' as never,
      }),
    ).rejects.toThrow('Sourcing findings can only be marked merged by promotion.')

    expect(
      database.select().from(sourcingFindings).where(eq(sourcingFindings.id, finding.id)).get(),
    ).toMatchObject({
      mergeStatus: 'new',
      mergedApplicationId: null,
    })
  })

  it('creates, lists, updates, and promotes sourcing findings into applications', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    const runRepository = createSqliteWorkflowRunRepository(database)
    const sourcingRepository = createSqliteSourcingRepository(database)
    const run = await runRepository.startRun({
      runType: 'sourcing',
      actorType: 'agent',
      actorName: 'codex',
      sourceName: 'LinkedIn',
      summary: 'Started LinkedIn sourcing.',
    })

    const finding = await sourcingRepository.createFinding({
      workflowRunId: run.id,
      sourceName: 'LinkedIn',
      companyName: 'Delta Labs',
      roleTitle: 'Software Engineering Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      timingMode: 'dates',
      startDate: '2027-01-15',
      endDate: '2027-06-01',
      locationRaw: 'United States / Remote',
      officialUrl: 'https://jobs.example.com/delta?utm_source=linkedin',
      sourceUrl: 'https://linkedin.com/jobs/view/123',
      postedAge: 'about 1 hour',
      priorityScore: 7,
      priorityBand: 'high',
      fitNotes: 'Backend platform internship.',
      discoveredAt: '2026-06-06T12:00:00.000Z',
    })
    const jobrightRun = await runRepository.startRun({
      runType: 'sourcing',
      actorType: 'agent',
      actorName: 'codex',
      sourceName: 'Jobright',
      summary: 'Started Jobright sourcing.',
    })
    await sourcingRepository.createFinding({
      workflowRunId: jobrightRun.id,
      sourceName: 'Jobright',
      companyName: 'Echo Health',
      roleTitle: 'Data Engineering Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      officialUrl: 'https://jobs.example.com/echo',
      discoveredAt: '2026-06-06T13:00:00.000Z',
    })

    expect(finding).toMatchObject({
      workflowRunId: run.id,
      sourceName: 'LinkedIn',
      companyName: 'Delta Labs',
      term: 'Spring 2027 / Summer 2027',
      terms: [
        { season: 'spring', year: 2027 },
        { season: 'summer', year: 2027 },
      ],
      timingMode: 'dates',
      startDate: '2027-01-15',
      endDate: '2027-06-01',
      mergeStatus: 'new',
      officialUrl: 'https://jobs.example.com/delta',
    })

    await expect(
      sourcingRepository.listFindings({ mergeStatus: 'new', sourceId: finding.sourceId }),
    ).resolves.toMatchObject({
      total: 1,
      items: [{ id: finding.id, roleTitle: 'Software Engineering Intern' }],
    })

    await expect(
      sourcingRepository.updateFinding({
        findingId: finding.id,
        duplicateNotes: 'No duplicate found before merge.',
      }),
    ).rejects.toThrow('duplicateNotes is generated by duplicate detection')

    const promoted = await sourcingRepository.promoteFinding({ findingId: finding.id })

    expect(promoted).toMatchObject({
      id: finding.id,
      mergeStatus: 'merged',
      mergedApplicationId: expect.any(String),
    })
    await expect(
      sourcingRepository.listFindings({ workflowRunId: run.id, mergeStatus: 'merged' }),
    ).resolves.toMatchObject({
      total: 1,
      items: [{ id: finding.id, mergedApplicationId: promoted.mergedApplicationId }],
    })
    expect(
      database
        .select()
        .from(applications)
        .where(eq(applications.id, promoted.mergedApplicationId ?? ''))
        .get(),
    ).toMatchObject({
      roleTitle: 'Software Engineering Intern',
      status: 'queued',
      term: 'Spring 2027 / Summer 2027',
      timingMode: 'dates',
      termsJson: '[{"season":"spring","year":2027},{"season":"summer","year":2027}]',
      startDate: '2027-01-15',
      endDate: '2027-06-01',
      currentPriorityScore: 7,
      currentPriorityBand: 'high',
    })
    expect(
      database
        .select()
        .from(applicationLinks)
        .where(eq(applicationLinks.applicationId, promoted.mergedApplicationId ?? ''))
        .all()
        .map((link) => link.kind),
    ).toEqual(['official', 'source'])
    expect(
      database
        .select()
        .from(applicationScores)
        .where(eq(applicationScores.applicationId, promoted.mergedApplicationId ?? ''))
        .all(),
    ).toHaveLength(1)
    expect(
      database
        .select()
        .from(applicationEvents)
        .where(eq(applicationEvents.applicationId, promoted.mergedApplicationId ?? ''))
        .all()
        .map((event) => event.type),
    ).toContain('merged_from_sourcing_finding')
  })

  it('updates sourcing timing modes and rejects mixed date and term input', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const runRepository = createSqliteWorkflowRunRepository(database)
    const sourcingRepository = createSqliteSourcingRepository(database)
    const run = await runRepository.startRun({
      runType: 'sourcing',
      actorType: 'agent',
      sourceName: 'LinkedIn',
      summary: 'Started LinkedIn sourcing.',
    })

    const finding = await sourcingRepository.createFinding({
      workflowRunId: run.id,
      sourceName: 'LinkedIn',
      companyName: 'Timing Labs',
      roleTitle: 'Software Engineering Intern',
      roleKind: 'internship',
      term: 'Fall 2026',
      country: 'US',
      workMode: 'remote',
      sourceUrl: 'https://linkedin.com/jobs/view/timing-labs',
      priorityScore: 8,
      priorityBand: 'high',
    })

    expect(finding).toMatchObject({
      term: 'Fall 2026',
      terms: [{ season: 'fall', year: 2026 }],
      timingMode: 'terms',
      startDate: null,
      endDate: null,
    })

    const dateMode = await sourcingRepository.updateFinding({
      findingId: finding.id,
      timingMode: 'dates',
      startDate: '2027-05-01',
      endDate: '2027-09-15',
    })

    expect(dateMode).toMatchObject({
      term: 'Summer 2027 / Fall 2027',
      terms: [
        { season: 'summer', year: 2027 },
        { season: 'fall', year: 2027 },
      ],
      timingMode: 'dates',
      startDate: '2027-05-01',
      endDate: '2027-09-15',
    })

    const unknownMode = await sourcingRepository.updateFinding({
      findingId: finding.id,
      timingMode: 'unknown',
      term: 'Internship',
    })

    expect(unknownMode).toMatchObject({
      term: 'Internship',
      terms: [],
      timingMode: 'unknown',
      startDate: null,
      endDate: null,
    })

    await expect(
      sourcingRepository.updateFinding({
        findingId: finding.id,
        term: 'Fall 2027',
        startDate: '2027-09-01',
      }),
    ).rejects.toThrow('Date-based timing cannot include term or terms input')
  })

  it('marks duplicate findings without creating another application', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    const runRepository = createSqliteWorkflowRunRepository(database)
    const sourcingRepository = createSqliteSourcingRepository(database)
    const run = await runRepository.startRun({
      runType: 'sourcing',
      actorType: 'agent',
      sourceName: 'LinkedIn',
      summary: 'Started LinkedIn sourcing.',
    })
    const finding = await sourcingRepository.createFinding({
      workflowRunId: run.id,
      sourceName: 'LinkedIn',
      companyName: 'Versant Media',
      roleTitle: 'Academic Year Internships: Platform Engineering',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      officialUrl:
        'https://jobs.example.test/remediated/41581ba03bdcb93e?utm_source=linkedin',
      priorityScore: 6,
      priorityBand: 'medium',
    })
    const applicationCount = database.select().from(applications).all().length

    const promoted = await sourcingRepository.promoteFinding({ findingId: finding.id })

    expect(promoted).toMatchObject({
      mergeStatus: 'duplicate',
      mergedApplicationId: 'application-versant-platform',
      mergeNotes: expect.stringContaining('Duplicate official URL'),
    })
    expect(database.select().from(applications).all()).toHaveLength(applicationCount)
    expect(
      database
        .select()
        .from(sourcingFindings)
        .where(eq(sourcingFindings.id, finding.id))
        .get(),
    ).toMatchObject({
      mergeStatus: 'duplicate',
      mergedApplicationId: 'application-versant-platform',
    })
  })
})
