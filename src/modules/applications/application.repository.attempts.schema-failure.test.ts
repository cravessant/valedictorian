import {
  applicationEvents,
  applications,
  workflowRuns,
  workflowRunSteps,
} from '../../db/schema'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createPgliteTestDatabase } from '../../test/pglite-test-owner'
import { seedSampleApplications } from './application.fixtures'
import { createPgliteApplicationRepository } from './application.repository'

type ApplicationRepositoryInstance = ReturnType<typeof createPgliteApplicationRepository>

async function createTestDatabase() {
  return createPgliteTestDatabase()
}

const passedVerificationReceiptPayload = {
  version: 1,
  scope: 'final_review',
  status: 'passed',
  verified: [
    'resume_attachment',
    'contact_info',
    'education',
    'work_authorization',
    'required_answers',
  ],
  unresolved: [],
  evidence:
    'Final review page showed the tailored resume, contact info, education, authorization, and required answers.',
}

async function recordVerificationReceipt(
  repository: ApplicationRepositoryInstance,
  applicationId: string,
  attemptId: string,
  payload: typeof passedVerificationReceiptPayload,
) {
  return repository.createApplicationAttemptStep({
    applicationId,
    attemptId,
    type: 'verification_receipt',
    message: 'Final review verification passed.',
    payload,
    actor: 'agent:codex',
  })
}

describe('PGlite application repository attempt schema failures', () => {
  it('rolls back attempt mutations when step or audit insertion fails', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
    const seededWorkflowRunCount = (await database.select().from(workflowRuns)).length
    const seededWorkflowRunStepCount = (await database.select().from(workflowRunSteps)).length

    await database.execute(sql.raw(`
      CREATE FUNCTION reject_attempt_started_event() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.type = 'attempt_started' THEN
          RAISE EXCEPTION 'audit insert failed';
        END IF;
        RETURN NEW;
      END;
      $$;
    `))
    await database.execute(sql.raw(`
      CREATE TRIGGER fail_attempt_started_event
        BEFORE INSERT ON application_events
        FOR EACH ROW EXECUTE FUNCTION reject_attempt_started_event();
    `))

    await expect(
      repository.startApplicationAttempt({
        applicationId: 'application-versant-platform',
        actorType: 'agent',
        actorName: 'codex',
        summary: 'Started application.',
      }),
    ).rejects.toThrow('Failed query: insert into "application_events"')
    expect(await database.select().from(workflowRuns)).toHaveLength(seededWorkflowRunCount)
    expect(await database.select().from(workflowRunSteps)).toHaveLength(seededWorkflowRunStepCount)
    expect(
      await database
        .select()
        .from(applications)
        .where(eq(applications.id, 'application-versant-platform'))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      status: 'queued',
    })

    await database.execute(sql.raw('DROP TRIGGER fail_attempt_started_event ON application_events;'))
    await database.execute(sql.raw('DROP FUNCTION reject_attempt_started_event();'))
    const attempt = await repository.startApplicationAttempt({
      applicationId: 'application-versant-platform',
      actorType: 'agent',
      actorName: 'codex',
      summary: 'Started application.',
    })
    await recordVerificationReceipt(
      repository,
      'application-versant-platform',
      attempt.id,
      passedVerificationReceiptPayload,
    )
    await database.execute(sql.raw(`
      CREATE FUNCTION reject_attempt_completed_step() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.type = 'attempt_completed' THEN
          RAISE EXCEPTION 'attempt step insert failed';
        END IF;
        RETURN NEW;
      END;
      $$;
    `))
    await database.execute(sql.raw(`
      CREATE TRIGGER fail_attempt_completed_step
        BEFORE INSERT ON workflow_run_steps
        FOR EACH ROW EXECUTE FUNCTION reject_attempt_completed_step();
    `))

    await expect(
      repository.completeApplicationAttempt({
        applicationId: 'application-versant-platform',
        attemptId: attempt.id,
        outcome: 'submitted',
        summary: 'Submitted application.',
      }),
    ).rejects.toThrow('Failed query: insert into "workflow_run_steps"')
    expect(
      await database
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, attempt.id))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      status: 'in_progress',
      outcome: null,
      completedAt: null,
    })
    expect(
      (await database
        .select()
        .from(workflowRunSteps)
        .where(eq(workflowRunSteps.workflowRunId, attempt.id)))
        .map((step) => step.type),
    ).toEqual(['attempt_started', 'verification_receipt'])
    expect(
      await database
        .select()
        .from(applications)
        .where(eq(applications.id, 'application-versant-platform'))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      status: 'in_progress',
      hasApplied: false,
    })
    expect(
      (await database
        .select()
        .from(applicationEvents)
        .where(eq(applicationEvents.applicationId, 'application-versant-platform')))
        .map((event) => event.type),
    ).toEqual(['attempt_started'])
  })
})
