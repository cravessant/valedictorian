import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  applicationEvents,
  applicationLinks,
  applicationScores,
  applications,
  opportunities,
  sources,
} from '../../db/schema'
import { useResettablePgliteTestDatabase } from '../../test/pglite-test-owner'
import { seedSampleApplications } from '../applications/application.fixtures'
import { createPglitePolicyRepository } from '../policy/policy.repository'
import { createPgliteWorkflowRunRepository } from '../workflow-runs/workflow-run.repository'
import { createPgliteSourcingRepository } from './sourcing.repository'

const resettableDatabase = useResettablePgliteTestDatabase()

async function createTestDatabase() { return resettableDatabase() }

describe.sequential('PGlite sourcing repository', () => {
  it('persists omitted country defaults and omits absent optional usability on manual create', async () => {
    const database = await createTestDatabase()
    const run = await createPgliteWorkflowRunRepository(database).startRun({
      runType: 'sourcing', actorType: 'human', sourceName: 'Manual', summary: 'Manual sourcing.',
    })
    const repository = createPgliteSourcingRepository(database)

    const created = await repository.createFinding({
      workflowRunId: run.id,
      sourceName: 'Manual',
      companyName: 'Unknown Country Co',
      roleTitle: 'Software Engineering Intern',
      roleKind: 'internship',
      workMode: 'unclear',
      officialUrl: 'https://jobs.example.com/unknown-country/role-1',
    })

    expect(created).toMatchObject({
      country: null,
      mergeStatus: 'blocked',
      policyBlocker: 'missing_country',
    })
    await expect(repository.getFinding(created.id)).resolves.toMatchObject({ country: null })

    const finding = await repository.createFinding({
      workflowRunId: run.id,
      sourceName: 'Manual',
      companyName: 'Manual Co',
      roleTitle: 'Software Engineering Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      officialUrl: 'https://jobs.example.com/manual/role-1',
    })

    expect(finding).not.toHaveProperty('usability')
    expect((await repository.listFindings()).items.find(({ id }) => id === finding.id))
      .not.toHaveProperty('usability')
  })

  it('reclassifies sourcing findings after create and update patches', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)
    const runRepository = createPgliteWorkflowRunRepository(database)
    const sourcingRepository = createPgliteSourcingRepository(database)
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
    const database = await createTestDatabase()
    await seedSampleApplications(database)
    const runRepository = createPgliteWorkflowRunRepository(database)
    const sourcingRepository = createPgliteSourcingRepository(database)
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
    const applicationCount = (await database.select().from(applications)).length

    const promoted = await sourcingRepository.promoteFinding({ findingId: finding.id })

    expect(promoted).toMatchObject({
      mergeStatus: 'below_cutoff',
      mergedApplicationId: null,
    })
    expect(await database.select().from(applications)).toHaveLength(applicationCount)
  })

  it('rejects promoting a disposed third-party block without a concrete review question', async () => {
    const database = await createTestDatabase()
    const runRepository = createPgliteWorkflowRunRepository(database)
    const sourcingRepository = createPgliteSourcingRepository(database)
    const run = await runRepository.startRun({
      runType: 'sourcing',
      actorType: 'agent',
      sourceName: 'LinkedIn',
      summary: 'Started LinkedIn sourcing.',
    })
    const finding = await sourcingRepository.createFinding({
      workflowRunId: run.id,
      sourceName: 'LinkedIn',
      companyName: 'Disposed Third Party Co',
      roleTitle: 'Software Engineering Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      sourceUrl: 'https://www.linkedin.com/jobs/view/999999',
      priorityScore: 8,
      priorityBand: 'high',
    })

    await database
      .update(opportunities)
      .set({
        destinationClass: 'third_party_job_posting',
        destinationUrl: 'https://www.linkedin.com/jobs/view/999999',
      })
      .where(eq(opportunities.id, finding.id))

    const decided = await sourcingRepository.decideFinding({
      findingId: finding.id,
      mergeStatus: 'blocked',
      policyBlocker: 'third_party_destination',
      dispositionReason: 'Do not promote this source.',
    })

    expect(decided).toMatchObject({
      mergeStatus: 'blocked',
      policyBlocker: 'third_party_destination',
      blocker: null,
      dispositionReason: 'Do not promote this source.',
      destinationClass: 'third_party_job_posting',
      destinationUrl: 'https://www.linkedin.com/jobs/view/999999',
      mergedApplicationId: null,
    })

    const applicationCount = (await database.select().from(applications)).length
    const before = await sourcingRepository.getFinding(finding.id)

    const result = await sourcingRepository.promoteFinding({ findingId: finding.id })

    expect(result).toMatchObject({
      mergeStatus: 'blocked',
      policyBlocker: 'third_party_destination',
      blocker: null,
      dispositionReason: 'Do not promote this source.',
      mergedApplicationId: null,
      updatedAt: before.updatedAt,
    })
    expect(await database.select().from(applications)).toHaveLength(applicationCount)
    await expect(sourcingRepository.getFinding(finding.id)).resolves.toMatchObject({
      mergeStatus: 'blocked',
      dispositionReason: 'Do not promote this source.',
      blocker: null,
      mergedApplicationId: null,
      updatedAt: before.updatedAt,
    })
  })

  it('promotes a third-party block when a concrete review question remains and no disposition exists', async () => {
    const database = await createTestDatabase()
    const runRepository = createPgliteWorkflowRunRepository(database)
    const sourcingRepository = createPgliteSourcingRepository(database)
    const run = await runRepository.startRun({
      runType: 'sourcing',
      actorType: 'agent',
      sourceName: 'LinkedIn',
      summary: 'Started LinkedIn sourcing.',
    })
    const finding = await sourcingRepository.createFinding({
      workflowRunId: run.id,
      sourceName: 'LinkedIn',
      companyName: 'Actionable Third Party Co',
      roleTitle: 'Software Engineering Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      sourceUrl: 'https://www.linkedin.com/jobs/view/123456',
      priorityScore: 8,
      priorityBand: 'high',
    })
    const reviewQuestion = 'Approve third-party LinkedIn destination before promotion?'

    await database
      .update(opportunities)
      .set({
        destinationClass: 'third_party_job_posting',
        destinationUrl: 'https://www.linkedin.com/jobs/view/123456',
        mergeStatus: 'blocked',
        policyBlocker: 'third_party_destination',
        blocker: reviewQuestion,
        dispositionReason: null,
        mergeNotes: reviewQuestion,
      })
      .where(eq(opportunities.id, finding.id))

    const before = await sourcingRepository.getFinding(finding.id)
    expect(before).toMatchObject({
      mergeStatus: 'blocked',
      policyBlocker: 'third_party_destination',
      blocker: reviewQuestion,
      dispositionReason: null,
    })

    const promoted = await sourcingRepository.promoteFinding({ findingId: finding.id })

    expect(promoted).toMatchObject({
      mergeStatus: 'merged',
      mergedApplicationId: expect.any(String),
      dispositionReason: null,
    })
  })

  it('uses policy cutoff overrides and apply override evidence for promotion', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)
    const policyRepository = createPglitePolicyRepository(database)
    await policyRepository.updateConfig({
      scoring: {
        applyCutoff: 7,
      },
    })
    const runRepository = createPgliteWorkflowRunRepository(database)
    const sourcingRepository = createPgliteSourcingRepository(database)
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
    const database = await createTestDatabase()
    const runRepository = createPgliteWorkflowRunRepository(database)
    const sourcingRepository = createPgliteSourcingRepository(database)
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
    const database = await createTestDatabase()
    const runRepository = createPgliteWorkflowRunRepository(database)
    const sourcingRepository = createPgliteSourcingRepository(database)
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
    const database = await createTestDatabase()
    const runRepository = createPgliteWorkflowRunRepository(database)
    const sourcingRepository = createPgliteSourcingRepository(database)
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
      await database.select().from(opportunities).where(eq(opportunities.id, finding.id)).limit(1).then(([row]) => row),
    ).toMatchObject({
      mergeStatus: 'new',
      applicationId: null,
    })
  })

  it('creates, lists, updates, and promotes sourcing findings into applications', async () => {
    // Temporary #283 parity: promotion intentionally spans non-atomic repository writes.
    const database = await createTestDatabase()
    await seedSampleApplications(database)
    const runRepository = createPgliteWorkflowRunRepository(database)
    const sourcingRepository = createPgliteSourcingRepository(database)
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
      await database
        .select()
        .from(applications)
        .where(eq(applications.id, promoted.mergedApplicationId ?? ''))
        .limit(1).then(([row]) => row),
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
      (await database
        .select()
        .from(applicationLinks)
        .where(eq(applicationLinks.applicationId, promoted.mergedApplicationId ?? '')))
        .map((link) => link.kind),
    ).toEqual(['official', 'source'])
    expect(
      await database
        .select()
        .from(applicationScores)
        .where(eq(applicationScores.applicationId, promoted.mergedApplicationId ?? ''))
        ,
    ).toHaveLength(1)
    expect(
      (await database
        .select()
        .from(applicationEvents)
        .where(eq(applicationEvents.applicationId, promoted.mergedApplicationId ?? '')))
        .map((event) => event.type),
    ).toContain('merged_from_sourcing_finding')
  })

  it('updates sourcing timing modes and rejects mixed date and term input', async () => {
    const database = await createTestDatabase()
    const runRepository = createPgliteWorkflowRunRepository(database)
    const sourcingRepository = createPgliteSourcingRepository(database)
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
    const database = await createTestDatabase()
    await seedSampleApplications(database)
    const runRepository = createPgliteWorkflowRunRepository(database)
    const sourcingRepository = createPgliteSourcingRepository(database)
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
    const applicationCount = (await database.select().from(applications)).length

    const promoted = await sourcingRepository.promoteFinding({ findingId: finding.id })

    expect(promoted).toMatchObject({
      mergeStatus: 'duplicate',
      mergedApplicationId: 'application-versant-platform',
      mergeNotes: expect.stringContaining('Duplicate official URL'),
    })
    expect(await database.select().from(applications)).toHaveLength(applicationCount)
    expect(
      await database
        .select()
        .from(opportunities)
        .where(eq(opportunities.id, finding.id))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      mergeStatus: 'duplicate',
      applicationId: 'application-versant-platform',
    })
  })

  it('preserves exact missing run and finding errors', async () => {
    const database = await createTestDatabase()
    const repository = createPgliteSourcingRepository(database)

    await expect(repository.getFinding('missing-finding')).rejects.toThrow(
      'Sourcing finding not found: missing-finding',
    )
    await expect(repository.createFinding({
      workflowRunId: 'missing-run',
      sourceName: 'Manual',
      companyName: 'Missing Run Co',
      roleTitle: 'Backend Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      officialUrl: 'https://jobs.example.com/missing-run/backend',
    })).rejects.toThrow('Workflow run not found: missing-run')
  })

  it('serializes concurrent deterministic source creation', async () => {
    const database = await createTestDatabase()
    const run = await createPgliteWorkflowRunRepository(database).startRun({
      runType: 'sourcing',
      actorType: 'agent',
      summary: 'Concurrent source creation.',
    })
    const repository = createPgliteSourcingRepository(database)
    const common = {
      workflowRunId: run.id,
      sourceName: 'Concurrent Board',
      roleKind: 'internship' as const,
      country: 'US',
      workMode: 'remote' as const,
      discoveredAt: '2026-07-18T00:00:00.000Z',
    }

    const results = await Promise.allSettled([
      repository.createFinding({
        ...common,
        companyName: 'Concurrent A',
        roleTitle: 'Backend Intern A',
        officialUrl: 'https://jobs.example.com/concurrent/a',
      }),
      repository.createFinding({
        ...common,
        companyName: 'Concurrent B',
        roleTitle: 'Backend Intern B',
        officialUrl: 'https://jobs.example.com/concurrent/b',
      }),
    ])
    const findings = results.map((result) => {
      expect(result.status).toBe('fulfilled')
      if (result.status !== 'fulfilled') throw result.reason
      return result.value
    })
    const listed = await repository.listFindings({ source: 'concurrent board' })

    expect(findings).toHaveLength(2)
    expect(await database.select().from(sources).where(eq(sources.name, 'Concurrent Board'))).toHaveLength(1)
    expect(listed.total).toBe(2)
    expect(listed.items.map(({ id }) => id)).toEqual(findings.map(({ id }) => id).sort())
  })

  it('preserves deterministic source slug conflicts', async () => {
    const database = await createTestDatabase()
    const run = await createPgliteWorkflowRunRepository(database).startRun({
      runType: 'sourcing',
      actorType: 'agent',
      summary: 'Source conflict proof.',
    })
    const repository = createPgliteSourcingRepository(database)

    await repository.createFinding({
      workflowRunId: run.id,
      sourceName: 'A-B',
      companyName: 'First Co',
      roleTitle: 'Backend Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      officialUrl: 'https://jobs.example.com/source-conflict/first',
    })

    await expect(repository.createFinding({
      workflowRunId: run.id,
      sourceName: 'A B',
      companyName: 'Second Co',
      roleTitle: 'Frontend Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      officialUrl: 'https://jobs.example.com/source-conflict/second',
    })).rejects.toThrow('Failed query: insert into "sources"')
    await expect(repository.listFindings()).resolves.toMatchObject({ total: 1 })
  })

})
