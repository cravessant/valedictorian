import { describe, expect, it, onTestFinished } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  applicationEvents,
  applicationScores,
  applications,
  opportunities,
  workflowRunSteps,
} from '../../db/schema'
import { createPgliteClient, migratePgliteDatabase, type PgliteDatabase } from '../../db/pglite'
import { seedSampleApplications } from '../applications/application.fixtures'
import { createPgliteWorkflowRunRepository } from '../workflow-runs/workflow-run.repository'
import { createPgliteSourcingProcessor } from './sourcing.processor'

async function createDatabase() {
  const client = await createPgliteClient()
  onTestFinished(() => client.close())
  const database = await migratePgliteDatabase(client)
  await seedSampleApplications(database)
  return database
}

async function createSourcingRun(database: PgliteDatabase) {
  return createPgliteWorkflowRunRepository(database).startRun({
    runType: 'sourcing',
    actorType: 'agent',
    actorName: 'codex',
    sourceId: 'source-linkedin',
    summary: 'Started LinkedIn sourcing.',
  })
}

describe('PGlite sourcing processor', () => {
  it('promotes a clean candidate, then records the application score', async () => {
    const database = await createDatabase()
    const run = await createSourcingRun(database)
    const processor = createPgliteSourcingProcessor(database)

    const finding = await processor.processCandidate({
      workflowRunId: run.id,
      sourceId: 'source-linkedin',
      companyName: 'Delta Labs',
      roleTitle: 'Software Engineering Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      officialUrl: 'https://jobs.example.com/delta?utm_source=linkedin',
      sourceUrl: 'https://linkedin.com/jobs/view/delta',
      score: {
        score: 8,
        band: 'high',
        roleRelevance: 3,
        careerSignal: 2,
        cityWorkMode: 2,
        compensationLogistics: 1,
        penalties: [],
        rationale: 'Strong SWE internship fit.',
        rubricVersion: 'processor-test',
      },
      cutoffScore: 7,
    })

    expect(finding).toMatchObject({
      mergeStatus: 'merged',
      mergedApplicationId: expect.any(String),
      officialUrl: 'https://jobs.example.com/delta',
    })
    expect(
      await database
        .select()
        .from(applications)
        .where(eq(applications.id, finding.mergedApplicationId ?? ''))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      roleTitle: 'Software Engineering Intern',
      status: 'queued',
      currentPriorityScore: 8,
      currentPriorityBand: 'high',
    })
    expect(
      await database
        .select()
        .from(applicationScores)
        .where(eq(applicationScores.applicationId, finding.mergedApplicationId ?? ''))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      score: 8,
      roleRelevance: 3,
      rationale: 'Strong SWE internship fit.',
      rubricVersion: 'processor-test',
    })
    expect(
      (await database
        .select()
        .from(applicationEvents)
        .where(eq(applicationEvents.applicationId, finding.mergedApplicationId ?? '')))
        .map((event) => event.type),
    ).toEqual(expect.arrayContaining(['merged_from_sourcing_finding', 'score_recorded']))
    expect(
      (await database
        .select()
        .from(workflowRunSteps)
        .where(eq(workflowRunSteps.workflowRunId, run.id)))
        .map((step) => step.type),
    ).toContain('sourcing_candidate_processed')
  })

  it('links duplicate official URL findings to the existing application', async () => {
    const database = await createDatabase()
    const run = await createSourcingRun(database)
    const processor = createPgliteSourcingProcessor(database)
    const applicationCount = (await database.select().from(applications)).length

    const finding = await processor.processCandidate({
      workflowRunId: run.id,
      sourceId: 'source-linkedin',
      companyName: 'Versant Media',
      roleTitle: 'Academic Year Internships: Platform Engineering',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      officialUrl:
        'https://jobs.example.test/remediated/41581ba03bdcb93e?utm_source=linkedin',
      sourceUrl: 'https://linkedin.com/jobs/view/versant-platform',
    })

    expect(finding).toMatchObject({
      mergeStatus: 'duplicate',
      mergedApplicationId: 'application-versant-platform',
      duplicateNotes: expect.stringContaining('official URL'),
    })
    expect(await database.select().from(applications)).toHaveLength(applicationCount)
  })

  it('links duplicate fingerprint findings to the existing application', async () => {
    const database = await createDatabase()
    const run = await createSourcingRun(database)
    const processor = createPgliteSourcingProcessor(database)

    const finding = await processor.processCandidate({
      workflowRunId: run.id,
      sourceId: 'source-linkedin',
      companyName: 'Versant Media',
      roleTitle: 'Academic Year Internships: Platform Engineering',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      officialUrl: 'https://jobs.example.com/versant/platform-engineering-internship',
      sourceUrl: 'https://linkedin.com/jobs/view/versant-platform-copy',
    })

    expect(finding).toMatchObject({
      mergeStatus: 'duplicate',
      mergedApplicationId: 'application-versant-platform',
      duplicateNotes: expect.stringContaining('fingerprint'),
    })
  })

  it('does not duplicate same company and role findings from a different source fingerprint', async () => {
    const database = await createDatabase()
    const runRepository = createPgliteWorkflowRunRepository(database)
    const run = await runRepository.startRun({
      runType: 'sourcing',
      actorType: 'agent',
      actorName: 'codex',
      sourceId: 'source-jobright',
      summary: 'Started Jobright sourcing.',
    })
    const processor = createPgliteSourcingProcessor(database)

    const finding = await processor.processCandidate({
      workflowRunId: run.id,
      sourceId: 'source-jobright',
      companyName: 'Versant Media',
      roleTitle: 'Academic Year Internships: Platform Engineering',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      sourceUrl: 'https://jobright.ai/jobs/info/versant-platform-engineering-copy',
    })

    expect(finding).toMatchObject({
      mergeStatus: 'merged',
      duplicateNotes: null,
      mergedApplicationId: expect.any(String),
    })
    expect(finding.mergedApplicationId).not.toBe('application-versant-platform')
  })

  it('blocks candidates that cannot be safely promoted', async () => {
    const database = await createDatabase()
    const run = await createSourcingRun(database)
    const processor = createPgliteSourcingProcessor(database)
    const applicationCount = (await database.select().from(applications)).length

    const finding = await processor.processCandidate({
      workflowRunId: run.id,
      sourceId: 'source-linkedin',
      companyName: 'Summit Cloud',
      roleTitle: 'Platform Engineering Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'onsite',
      locationRaw: 'Boulder, CO / Onsite',
    })

    expect(finding).toMatchObject({
      mergeStatus: 'blocked',
      blocker: expect.stringContaining('officialUrl or sourceUrl'),
      mergedApplicationId: null,
    })
    expect(await database.select().from(applications)).toHaveLength(applicationCount)
    expect(
      await database.select().from(opportunities).where(eq(opportunities.id, finding.id)).limit(1).then(([row]) => row),
    ).toMatchObject({ mergeStatus: 'blocked' })
    const processingStep = (await database
      .select()
      .from(workflowRunSteps)
      .where(eq(workflowRunSteps.workflowRunId, run.id)))
      .find(({ type }) => type === 'sourcing_candidate_processed')
    expect(processingStep).toMatchObject({
      type: 'sourcing_candidate_processed',
      message: 'Processed sourcing candidate: blocked.',
    })
    expect(JSON.parse(processingStep?.payloadJson ?? '{}')).toMatchObject({
      decision: 'blocked',
      findingId: finding.id,
    })
  })

  it('routes below-cutoff promoted applications to not_fit after scoring', async () => {
    const database = await createDatabase()
    const run = await createSourcingRun(database)
    const processor = createPgliteSourcingProcessor(database)

    const finding = await processor.processCandidate({
      workflowRunId: run.id,
      sourceId: 'source-linkedin',
      companyName: 'Northstar Robotics',
      roleTitle: 'Automation Analyst Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'hybrid',
      officialUrl: 'https://jobs.example.com/northstar/automation-analyst-intern',
      score: {
        score: 4,
        band: 'low',
        roleRelevance: 1,
        careerSignal: 1,
        cityWorkMode: 1,
        compensationLogistics: 1,
        penalties: [],
        rationale: 'Automation analyst role is below SWE cutoff.',
        rubricVersion: 'processor-test',
      },
      cutoffScore: 7,
    })

    expect(
      await database
        .select()
        .from(applications)
        .where(eq(applications.id, finding.mergedApplicationId ?? ''))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      status: 'not_fit',
      currentPriorityScore: 4,
      currentPriorityBand: 'low',
    })
  })
})
