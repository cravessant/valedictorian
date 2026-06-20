import { describe, expect, it } from 'vitest'
import { defaultPolicyConfig } from 'sparxie'
import { eq } from 'drizzle-orm'
import {
  applications,
  policyConfig,
  policyEvidence,
  workflowRuns,
  workflowRunSteps,
} from '../../db/schema'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { seedSampleApplications } from '../applications/application.fixtures'
import { createSqliteApplicationRepository } from '../applications/application.repository'
import { createSqlitePolicyRepository } from './policy.repository'

const passedVerificationReceiptPayload = {
  version: 1,
  scope: 'final_review',
  status: 'passed',
  verified: ['resume_attachment', 'contact_info', 'education', 'work_authorization'],
  unresolved: [],
  evidence: 'Final review page showed correct material fields.',
}

describe('SQLite policy repository', () => {
  it('persists policy config overrides and resets to defaults', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqlitePolicyRepository(database)

    await expect(repository.getConfig()).resolves.toEqual(defaultPolicyConfig)

    await expect(
      repository.updateConfig({
        scoring: {
          applyCutoff: 7,
        },
        actionQueue: {
          staleLockHours: 3,
        },
      }),
    ).resolves.toMatchObject({
      scoring: { applyCutoff: 7 },
      actionQueue: { staleLockHours: 3 },
    })
    expect(database.select().from(policyConfig).all()).toHaveLength(1)
    await expect(repository.resetConfig()).resolves.toEqual(defaultPolicyConfig)
  })

  it('records and lists policy evidence without mutating the subject row', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    const repository = createSqlitePolicyRepository(database)

    const before = database
      .select()
      .from(applications)
      .where(eq(applications.id, 'application-versant-platform'))
      .get()
    const evidence = await repository.recordEvidence({
      subjectType: 'application',
      subjectId: 'application-versant-platform',
      tag: 'explicit_user_approval',
      note: 'User approved this specific application.',
      source: 'user',
      payload: {
        approvedBy: 'keni',
      },
    })
    const after = database
      .select()
      .from(applications)
      .where(eq(applications.id, 'application-versant-platform'))
      .get()

    expect(evidence).toMatchObject({
      subjectType: 'application',
      subjectId: 'application-versant-platform',
      tag: 'explicit_user_approval',
      source: 'user',
    })
    expect(JSON.parse(evidence.payloadJson)).toEqual({ approvedBy: 'keni' })
    expect(database.select().from(policyEvidence).all()).toHaveLength(1)
    expect(after).toEqual(before)
    await expect(
      repository.listEvidence({
        subjectType: 'application',
        subjectId: 'application-versant-platform',
      }),
    ).resolves.toEqual([evidence])
  })

  it('evaluates application submit gates from company policy and approval evidence', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    const applicationRepository = createSqliteApplicationRepository(database)
    const policyRepository = createSqlitePolicyRepository(database)
    const created = await applicationRepository.createApplication({
      companyName: 'TikTok',
      roleTitle: 'Software Engineer Intern',
      sourceName: 'LinkedIn',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      status: 'queued',
      primaryLink: {
        kind: 'official',
        label: 'official',
        url: 'https://careers.tiktok.com/job/123',
      },
    })
    const attempt = await applicationRepository.startApplicationAttempt({
      applicationId: created.id,
      actorType: 'agent',
      actorName: 'codex',
    })
    await applicationRepository.createApplicationAttemptStep({
      applicationId: created.id,
      attemptId: attempt.id,
      type: 'verification_receipt',
      message: 'Final review verification passed.',
      payload: passedVerificationReceiptPayload,
      actor: 'agent:codex',
    })

    await expect(
      policyRepository.evaluateApplication({
        applicationId: created.id,
        attemptId: attempt.id,
        outcome: 'submitted',
      }),
    ).resolves.toMatchObject({
      status: 'needs_review',
      action: 'hold_for_user_review',
      requiredEvidence: ['explicit_user_approval'],
    })
    await policyRepository.recordEvidence({
      subjectType: 'application',
      subjectId: created.id,
      tag: 'explicit_user_approval',
      source: 'user',
      note: 'User chose to spend a TikTok application slot.',
    })
    await expect(
      policyRepository.evaluateApplication({
        applicationId: created.id,
        attemptId: attempt.id,
        outcome: 'submitted',
      }),
    ).resolves.toMatchObject({
      status: 'allow',
      action: 'allow_submit',
    })
  })

  it('computes scheduler-ready run windows without creating runs', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqlitePolicyRepository(database)

    const decision = await repository.evaluateRunWindow({
      sourceName: 'LinkedIn',
      now: '2026-06-08T18:00:00.000Z',
      previousRunCompletedAt: '2026-06-08T17:00:00.000Z',
      timezone: 'America/New_York',
    })

    expect(decision).toMatchObject({
      action: 'recommend_run_window',
      status: 'allow',
      recommendedCoverageEndedAt: '2026-06-08T18:00:00.000Z',
    })
    expect(decision.recommendedCoverageStartedAt).toBe('2026-06-08T16:30:00.000Z')
    expect(database.select().from(workflowRuns).all()).toHaveLength(0)
    expect(database.select().from(workflowRunSteps).all()).toHaveLength(0)
  })
})
