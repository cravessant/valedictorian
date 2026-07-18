import {
  applicationAttemptSteps,
  applicationAttempts,
  applicationEvents,
  applicationWorkflowStates,
  applications,
  workflowRuns,
  workflowRunSteps,
} from '../../db/schema'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createPgliteClient, migratePgliteDatabase } from '../../db/pglite'
import { seedSampleApplications } from './application.fixtures'
import { createPgliteApplicationRepository } from './application.repository'
import { createPglitePolicyRepository } from '../policy/policy.repository'

type ApplicationRepositoryInstance = ReturnType<typeof createPgliteApplicationRepository>

async function createTestDatabase() {
  const client = await createPgliteClient()
  onTestFinished(() => client.close())
  return migratePgliteDatabase(client)
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

const failedVerificationReceiptPayload = {
  version: 1,
  scope: 'final_review',
  status: 'failed',
  verified: ['resume_attachment', 'contact_info'],
  unresolved: ['Confirm Fall 2026 exact start date', 'Confirm onsite availability'],
  evidence: 'Application was reviewed up to the submit boundary with unresolved availability questions.',
}

async function recordVerificationReceipt(
  repository: ApplicationRepositoryInstance,
  applicationId: string,
  attemptId: string,
  payload: typeof passedVerificationReceiptPayload | typeof failedVerificationReceiptPayload,
) {
  return repository.createApplicationAttemptStep({
    applicationId,
    attemptId,
    type: 'verification_receipt',
    message:
      payload.status === 'passed'
        ? 'Final review verification passed.'
        : 'Final review verification failed.',
    payload,
    actor: 'agent:codex',
  })
}

describe('PGlite application repository workflow attempts', () => {
  it('starts an application attempt with a lock, first step, and audit event', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database) as ReturnType<
      typeof createPgliteApplicationRepository
    > & {
      startApplicationAttempt(input: {
        applicationId: string
        actorType: string
        actorName?: string
        entryUrl?: string
        resumeVariant?: string
        resumeArtifactPath?: string
        summary?: string
      }): Promise<{
        id: string
        applicationId: string
        status: string
        actorType: string
        actorName: string | null
        steps: Array<{ sequence: number; type: string; message: string }>
      }>
    }

    const attempt = await repository.startApplicationAttempt({
      applicationId: 'application-versant-platform',
      actorType: 'agent',
      actorName: 'codex',
      entryUrl: 'https://jobs.example.test/remediated/41581ba03bdcb93e',
      resumeVariant: 'bachelor_dec_2027',
      resumeArtifactPath:
        'tailored_resumes/2026-06-04-versant-platform-engineering/Kenny_Lin_Versant_Platform_Engineering_Resume.pdf',
      summary: 'Started SmartRecruiters application.',
    })

    expect(attempt).toMatchObject({
      applicationId: 'application-versant-platform',
      status: 'in_progress',
      actorType: 'agent',
      actorName: 'codex',
      steps: [
        {
          sequence: 1,
          type: 'attempt_started',
          message: 'Started SmartRecruiters application.',
        },
      ],
    })
    expect(await database.select().from(applicationAttempts)).toHaveLength(0)
    expect(await database.select().from(applicationAttemptSteps)).toHaveLength(0)
    expect(
      await database.select().from(workflowRuns).where(eq(workflowRuns.id, attempt.id)).limit(1).then(([row]) => row),
    ).toMatchObject({
      id: attempt.id,
      subjectApplicationId: 'application-versant-platform',
      runType: 'application_attempt',
      status: 'in_progress',
      outcome: null,
    })
    expect(
      await database
        .select()
        .from(workflowRunSteps)
        .where(eq(workflowRunSteps.workflowRunId, attempt.id))
        ,
    ).toEqual([
      expect.objectContaining({
        sequence: 1,
        type: 'attempt_started',
        message: 'Started SmartRecruiters application.',
      }),
    ])
    expect(
      await database
        .select()
        .from(applications)
        .where(eq(applications.id, 'application-versant-platform'))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      status: 'in_progress',
    })
    expect(
      await database
        .select()
        .from(applicationWorkflowStates)
        .where(eq(applicationWorkflowStates.applicationId, 'application-versant-platform'))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      applicationId: 'application-versant-platform',
      lockStartedAt: expect.any(String),
    })
    expect(
      (await database
        .select()
        .from(applicationEvents)
        .where(eq(applicationEvents.applicationId, 'application-versant-platform')))
        .map((event) => event.type),
    ).toEqual(['attempt_started'])
  })

  it('rejects a second active attempt for the same application', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)

    await repository.startApplicationAttempt({
      applicationId: 'application-versant-platform',
      actorType: 'agent',
      actorName: 'codex',
      summary: 'Started first application attempt.',
    })

    await expect(
      repository.startApplicationAttempt({
        applicationId: 'application-versant-platform',
        actorType: 'agent',
        actorName: 'codex',
        summary: 'Started second application attempt.',
      }),
    ).rejects.toThrow('Application attempt already in progress')
    expect(
      await database
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.subjectApplicationId, 'application-versant-platform'))
        ,
    ).toHaveLength(1)
  })

  it('appends attempt steps in sequence order', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database) as ReturnType<
      typeof createPgliteApplicationRepository
    > & {
      startApplicationAttempt(input: {
        applicationId: string
        actorType: string
        actorName?: string
        summary?: string
      }): Promise<{ id: string }>
      createApplicationAttemptStep(input: {
        applicationId: string
        attemptId: string
        type: string
        message: string
        payload?: unknown
        actor?: string
      }): Promise<{ sequence: number; type: string; message: string; payloadJson: string }>
    }
    const attempt = await repository.startApplicationAttempt({
      applicationId: 'application-versant-platform',
      actorType: 'agent',
      actorName: 'codex',
      summary: 'Started application.',
    })

    const step = await repository.createApplicationAttemptStep({
      applicationId: 'application-versant-platform',
      attemptId: attempt.id,
      type: 'resume_uploaded',
      message: 'Uploaded tailored resume.',
      payload: {
        artifactPath: 'tailored_resumes/versant/resume.pdf',
      },
      actor: 'agent:codex',
    })

    expect(step).toMatchObject({
      sequence: 2,
      type: 'resume_uploaded',
      message: 'Uploaded tailored resume.',
      payloadJson: '{"artifactPath":"tailored_resumes/versant/resume.pdf"}',
    })
    expect(
      (await database
        .select()
        .from(workflowRunSteps)
        .where(eq(workflowRunSteps.workflowRunId, attempt.id)))
        .map((attemptStep) => attemptStep.type),
    ).toEqual(['attempt_started', 'resume_uploaded'])
  })

  it('completes a submitted attempt and clears workflow blockers in one transaction', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
    const attempt = await repository.startApplicationAttempt({
      applicationId: 'application-versant-platform',
      actorType: 'agent',
      actorName: 'codex',
      summary: 'Started application.',
    })

    await repository.updateApplicationWorkflow({
      applicationId: 'application-versant-platform',
      missingUserInfo: 'Previous missing answer',
      blockerReason: 'Previous blocker',
      manualReviewKind: 'overridable',
      holdStartedAt: '2026-06-04T10:00:00.000Z',
    })
    await recordVerificationReceipt(
      repository,
      'application-versant-platform',
      attempt.id,
      passedVerificationReceiptPayload,
    )
    const completed = await repository.completeApplicationAttempt({
      applicationId: 'application-versant-platform',
      attemptId: attempt.id,
      outcome: 'submitted',
      summary: 'Submitted and verified confirmation.',
      confirmationUrl: 'https://jobs.smartrecruiters.com/confirmation/versant',
      confirmationText: 'Application submitted',
    })

    expect(completed).toMatchObject({
      id: attempt.id,
      status: 'completed',
      outcome: 'submitted',
      completedAt: expect.any(String),
      confirmationUrl: 'https://jobs.smartrecruiters.com/confirmation/versant',
      confirmationText: 'Application submitted',
    })
    expect(completed.steps.at(-1)).toMatchObject({
      sequence: 3,
      type: 'attempt_completed',
      message: 'Submitted and verified confirmation.',
    })
    expect(
      await database
        .select()
        .from(applications)
        .where(eq(applications.id, 'application-versant-platform'))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      status: 'submitted',
      hasApplied: true,
    })
    expect(
      await database
        .select()
        .from(applicationWorkflowStates)
        .where(eq(applicationWorkflowStates.applicationId, 'application-versant-platform'))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      lockStartedAt: null,
      holdStartedAt: null,
      manualReviewKind: null,
      missingUserInfo: null,
      blockerReason: null,
    })
    expect(
      (await database
        .select()
        .from(applicationEvents)
        .where(eq(applicationEvents.applicationId, 'application-versant-platform')))
        .map((event) => event.type),
    ).toEqual(['attempt_started', 'workflow_updated', 'attempt_completed'])
  })

  it('rejects submitted completion without a passed final-review verification receipt', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
    const attempt = await repository.startApplicationAttempt({
      applicationId: 'application-versant-platform',
      actorType: 'agent',
      actorName: 'codex',
      summary: 'Started application.',
    })

    await expect(
      repository.completeApplicationAttempt({
        applicationId: 'application-versant-platform',
        attemptId: attempt.id,
        outcome: 'submitted',
        summary: 'Submitted and verified confirmation.',
      }),
    ).rejects.toThrow('submitted attempts require a passed final-review verification receipt')
  })

  it('rejects submitted completion with a failed final-review verification receipt', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
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
      failedVerificationReceiptPayload,
    )

    await expect(
      repository.completeApplicationAttempt({
        applicationId: 'application-versant-platform',
        attemptId: attempt.id,
        outcome: 'submitted',
        summary: 'Submitted and verified confirmation.',
      }),
    ).rejects.toThrow('submitted attempts require a passed final-review verification receipt')
  })

  it('rejects explicit-approval company submission until policy evidence is recorded', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
    const policyRepository = createPglitePolicyRepository(database)
    const application = await repository.createApplication({
      companyName: 'ByteDance',
      roleTitle: 'Software Engineer Intern',
      sourceName: 'LinkedIn',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      status: 'queued',
      primaryLink: {
        kind: 'official',
        label: 'official',
        url: 'https://jobs.bytedance.com/en/position/123',
      },
    })
    const attempt = await repository.startApplicationAttempt({
      applicationId: application.id,
      actorType: 'agent',
      actorName: 'codex',
      summary: 'Started ByteDance application.',
    })
    await recordVerificationReceipt(
      repository,
      application.id,
      attempt.id,
      passedVerificationReceiptPayload,
    )

    await expect(
      repository.completeApplicationAttempt({
        applicationId: application.id,
        attemptId: attempt.id,
        outcome: 'submitted',
        summary: 'Submitted and verified confirmation.',
      }),
    ).rejects.toThrow('Policy requires explicit user approval before submitted')

    await policyRepository.recordEvidence({
      subjectType: 'application',
      subjectId: application.id,
      tag: 'explicit_user_approval',
      source: 'user',
      note: 'Approved this ByteDance application slot.',
    })
    await expect(
      repository.completeApplicationAttempt({
        applicationId: application.id,
        attemptId: attempt.id,
        outcome: 'submitted',
        summary: 'Submitted and verified confirmation.',
      }),
    ).resolves.toMatchObject({
      outcome: 'submitted',
      status: 'completed',
    })
  })

  it('rejects ready-for-review completion without a final-review verification receipt', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
    const attempt = await repository.startApplicationAttempt({
      applicationId: 'application-versant-platform',
      actorType: 'agent',
      actorName: 'codex',
      summary: 'Started application.',
    })

    await expect(
      repository.completeApplicationAttempt({
        applicationId: 'application-versant-platform',
        attemptId: attempt.id,
        outcome: 'ready_for_review',
        summary: 'Stopped at submit boundary for manual review.',
        holdStartedAt: '2026-06-04T16:05:00.000Z',
        manualReviewKind: 'overridable',
      }),
    ).rejects.toThrow('ready_for_review attempts require a final-review verification receipt')
  })

  it('completes ready-for-review with a failed receipt and unresolved items', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
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
      failedVerificationReceiptPayload,
    )

    const completed = await repository.completeApplicationAttempt({
      applicationId: 'application-versant-platform',
      attemptId: attempt.id,
      outcome: 'ready_for_review',
      summary: 'Stopped at submit boundary for manual review.',
      holdStartedAt: '2026-06-04T16:05:00.000Z',
      manualReviewKind: 'overridable',
    })

    expect(completed).toMatchObject({
      id: attempt.id,
      status: 'completed',
      outcome: 'ready_for_review',
    })
  })

  it('completes blocker outcomes without a verification receipt when blocker details are present', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
    const policyRepository = createPglitePolicyRepository(database)
    const attempt = await repository.startApplicationAttempt({
      applicationId: 'application-versant-platform',
      actorType: 'agent',
      actorName: 'codex',
      summary: 'Started application.',
    })
    await policyRepository.recordEvidence({
      subjectType: 'application',
      subjectId: 'application-versant-platform',
      tag: 'profile_retry_completed',
      source: 'agent',
      note: 'Retried with Profile 2.',
    })
    await policyRepository.recordEvidence({
      subjectType: 'application',
      subjectId: 'application-versant-platform',
      tag: 'headed_profile_retry_completed',
      source: 'agent',
      note: 'Retried headed with Profile 2.',
    })

    const completed = await repository.completeApplicationAttempt({
      applicationId: 'application-versant-platform',
      attemptId: attempt.id,
      outcome: 'platform_error',
      summary: 'Portal stayed disabled after verified retries.',
      blockerReason: 'SmartRecruiters submit stayed disabled after Profile 2 retry.',
    })

    expect(completed).toMatchObject({
      id: attempt.id,
      status: 'completed',
      outcome: 'platform_error',
    })
  })

  it('completes a needs-user-info attempt and exposes the updated application state', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
    const attempt = await repository.startApplicationAttempt({
      applicationId: 'application-versant-platform',
      actorType: 'agent',
      actorName: 'codex',
      summary: 'Started application.',
    })

    const completed = await repository.completeApplicationAttempt({
      applicationId: 'application-versant-platform',
      attemptId: attempt.id,
      outcome: 'needs_user_info',
      summary: 'Stopped for user-provided work authorization details.',
      missingUserInfo: 'Confirm work authorization answer.',
    })

    expect(completed).toMatchObject({
      id: attempt.id,
      status: 'completed',
      outcome: 'needs_user_info',
    })
    expect(
      await database
        .select()
        .from(applicationWorkflowStates)
        .where(eq(applicationWorkflowStates.applicationId, 'application-versant-platform'))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      lockStartedAt: null,
      missingUserInfo: 'Confirm work authorization answer.',
      blockerReason: null,
    })
    await expect(repository.getApplication('application-versant-platform')).resolves.toMatchObject({
      status: 'needs_user_info',
    })
  })

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

  it('lists application attempts newest first with their ordered steps', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database) as ReturnType<
      typeof createPgliteApplicationRepository
    > & {
      startApplicationAttempt(input: {
        applicationId: string
        actorType: string
        actorName?: string
        summary?: string
      }): Promise<{ id: string }>
      createApplicationAttemptStep(input: {
        applicationId: string
        attemptId: string
        type: string
        message: string
      }): Promise<unknown>
      completeApplicationAttempt(input: {
        applicationId: string
        attemptId: string
        outcome: string
        summary?: string
      }): Promise<unknown>
      listApplicationAttempts(input: {
        applicationId: string
        limit?: number
        offset?: number
      }): Promise<{
        total: number
        limit: number
        offset: number
        hasMore: boolean
        items: Array<{ id: string; summary: string | null; steps: Array<{ type: string }> }>
      }>
    }
    const policyRepository = createPglitePolicyRepository(database)
    const firstAttempt = await repository.startApplicationAttempt({
      applicationId: 'application-versant-platform',
      actorType: 'agent',
      actorName: 'codex',
      summary: 'First attempt.',
    })
    await policyRepository.recordEvidence({
      subjectType: 'application',
      subjectId: 'application-versant-platform',
      tag: 'profile_retry_completed',
      source: 'agent',
      note: 'Retried with Profile 2.',
    })
    await policyRepository.recordEvidence({
      subjectType: 'application',
      subjectId: 'application-versant-platform',
      tag: 'headed_profile_retry_completed',
      source: 'agent',
      note: 'Retried headed with Profile 2.',
    })
    await repository.completeApplicationAttempt({
      applicationId: 'application-versant-platform',
      attemptId: firstAttempt.id,
      outcome: 'platform_error',
      summary: 'Stopped on platform error.',
      blockerReason: 'SmartRecruiters validation loop',
    } as never)
    await database
      .update(workflowRuns)
      .set({ startedAt: '2026-06-04T16:00:00.000Z' })
      .where(eq(workflowRuns.id, firstAttempt.id))

    const secondAttempt = await repository.startApplicationAttempt({
      applicationId: 'application-versant-platform',
      actorType: 'agent',
      actorName: 'codex',
      summary: 'Second attempt.',
    })
    await repository.createApplicationAttemptStep({
      applicationId: 'application-versant-platform',
      attemptId: secondAttempt.id,
      type: 'page_verified',
      message: 'Verified contact page.',
    })
    await database
      .update(workflowRuns)
      .set({ startedAt: '2026-06-04T17:00:00.000Z' })
      .where(eq(workflowRuns.id, secondAttempt.id))

    await database
      .insert(workflowRuns)
      .values({
        id: 'workflow-run-broad-audit',
        actorName: 'codex',
        actorType: 'agent',
        blocker: null,
        completedAt: null,
        coverageEndedAt: null,
        coverageStartedAt: null,
        createdAt: '2026-06-04T18:00:00.000Z',
        deletedAt: null,
        inputJson: '{}',
        metadataJson: '{}',
        outcome: null,
        runType: 'application_attempt',
        sourceId: null,
        startedAt: '2026-06-04T18:00:00.000Z',
        status: 'in_progress',
        subjectApplicationId: 'application-versant-platform',
        summary: 'Broad audit workflow, not an application attempt lifecycle.',
        timezone: null,
        updatedAt: '2026-06-04T18:00:00.000Z',
      })

    await database
      .insert(workflowRunSteps)
      .values({
        id: 'workflow-run-broad-audit-step-1',
        actor: 'agent:codex',
        createdAt: '2026-06-04T18:00:00.000Z',
        message: 'Broad workflow started.',
        payloadJson: '{}',
        sequence: 1,
        type: 'run_started',
        workflowRunId: 'workflow-run-broad-audit',
      })


    await expect(
      repository.listApplicationAttempts({
        applicationId: 'application-versant-platform',
        limit: 1,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      total: 2,
      limit: 1,
      offset: 0,
      hasMore: true,
      items: [
        {
          id: secondAttempt.id,
          summary: 'Second attempt.',
          steps: [
            { type: 'attempt_started' },
            { type: 'page_verified' },
          ],
        },
      ],
    })
  })

  it('allows only one concurrent active attempt per application', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)
    const repository = createPgliteApplicationRepository(database)
    const input = {
      applicationId: 'application-versant-platform',
      actorType: 'agent' as const,
      actorName: 'codex',
      summary: 'Concurrent attempt.',
    }
    const results = await Promise.allSettled([
      repository.startApplicationAttempt(input),
      repository.startApplicationAttempt(input),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

})
