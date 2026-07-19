import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import {
  applicationEvents,
  applicationScores,
  applications,
  opportunities,
  workflowRunSteps,
} from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'
import { createPgliteTestDatabase } from '../../test/pglite-test-owner'
import { seedSampleApplications } from '../applications/application.fixtures'
import { createPgliteWorkflowRunRepository } from '../workflow-runs/workflow-run.repository'
import { createPgliteSourcingProcessor } from './sourcing.processor'

async function createDatabase() {
  const database = await createPgliteTestDatabase()
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

async function failSourcingProcessingStep(database: PgliteDatabase) {
  await database.execute(sql.raw(`
    CREATE FUNCTION fail_sourcing_processing_step() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.type = 'sourcing_candidate_processed' THEN
        RAISE EXCEPTION 'sourcing processing step failed';
      END IF;
      RETURN NEW;
    END;
    $$;
  `))
  await database.execute(sql.raw(`
    CREATE TRIGGER fail_sourcing_processing_steps
      BEFORE INSERT ON workflow_run_steps
      FOR EACH ROW EXECUTE FUNCTION fail_sourcing_processing_step();
  `))
}

describe('PGlite sourcing processor schema failures', () => {

  it('rolls back the complete post-promotion invariant when the processing step fails', async () => {
    const database = await createDatabase()
    const run = await createSourcingRun(database)
    const processor = createPgliteSourcingProcessor(database)
    await failSourcingProcessingStep(database)

    await expect(processor.processCandidate({
      workflowRunId: run.id,
      sourceId: 'source-linkedin',
      companyName: 'Rollback Robotics',
      roleTitle: 'Atomicity Engineering Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'hybrid',
      officialUrl: 'https://jobs.example.com/rollback/atomicity-engineering-intern',
      score: {
        score: 4,
        band: 'low',
        roleRelevance: 1,
        careerSignal: 1,
        cityWorkMode: 1,
        compensationLogistics: 1,
        penalties: [],
        rationale: 'Below cutoff to exercise every post-promotion write.',
        rubricVersion: 'processor-rollback-test',
      },
      cutoffScore: 7,
    })).rejects.toThrow('Failed query: insert into "workflow_run_steps"')

    const [finding] = await database
      .select()
      .from(opportunities)
      .where(eq(opportunities.roleTitle, 'Atomicity Engineering Intern'))
      .limit(1)
    expect(finding).toMatchObject({
      mergeStatus: 'merged',
      applicationId: expect.any(String),
    })

    const applicationId = finding?.applicationId ?? ''
    expect(
      await database.select().from(applications).where(eq(applications.id, applicationId)).limit(1).then(([row]) => row),
    ).toMatchObject({
      status: 'queued',
      currentPriorityScore: null,
      currentPriorityBand: null,
    })
    expect(
      await database.select().from(applicationScores).where(eq(applicationScores.applicationId, applicationId)),
    ).toHaveLength(0)
    expect(
      (await database.select().from(applicationEvents).where(eq(applicationEvents.applicationId, applicationId)))
        .map(({ type }) => type),
    ).not.toEqual(expect.arrayContaining(['score_recorded', 'status_updated']))
    expect(
      (await database.select().from(workflowRunSteps).where(eq(workflowRunSteps.workflowRunId, run.id)))
        .map(({ type }) => type),
    ).not.toContain('sourcing_candidate_processed')
  })
})
