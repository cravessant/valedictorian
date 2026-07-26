import { describe, expect, it } from 'vitest'
import { defaultPolicyConfig } from '@sparxie/sdk'
import { eq } from 'drizzle-orm'
import {
  applications,
  policyConfig,
  policyEvidence,
  workflowRuns,
  workflowRunSteps,
} from '../../db/schema'
import {
  type PgliteDatabase,
} from '../../db/pglite'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { seedCanonicalApplication } from '../../test-fixtures/canonical-application.fixture'
import { createPglitePolicyRepository } from './policy.repository'

const passedVerificationReceiptPayload = {
  version: 1,
  scope: 'final_review',
  status: 'passed',
  verified: ['resume_attachment', 'contact_info', 'education', 'work_authorization'],
  unresolved: [],
  evidence: 'Final review page showed correct material fields.',
}

const resettableOwner = useResettablePgliteTestOwner()

async function openMigratedPolicyDb() {
  const { database } = resettableOwner()
  return {
    close: async () => {},
    database,
    repository: createPglitePolicyRepository(database),
  }
}

async function seedTikTokApplication(database: PgliteDatabase) {
  const now = '2026-06-08T12:00:00.000Z'
  await seedCanonicalApplication(database, {
    id: 'application-tiktok', companyName: 'TikTok',
    roleTitle: 'Software Engineer Intern', workMode: 'remote', createdAt: now,
  })
  await database.insert(workflowRuns).values({
    id: 'attempt-tiktok',
    runType: 'application_attempt',
    status: 'running',
    actorType: 'agent',
    actorName: 'codex',
    sourceId: null,
    subjectApplicationId: 'application-tiktok',
    startedAt: now,
    completedAt: null,
    coverageStartedAt: null,
    coverageEndedAt: null,
    timezone: null,
    inputJson: '{}',
    summary: null,
    outcome: null,
    blocker: null,
    metadataJson: '{}',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  await database.insert(workflowRunSteps).values({
    id: 'step-verification',
    workflowRunId: 'attempt-tiktok',
    sequence: 1,
    type: 'verification_receipt',
    message: 'Final review verification passed.',
    payloadJson: JSON.stringify(passedVerificationReceiptPayload),
    actor: 'agent:codex',
    createdAt: now,
  })
}

describe.sequential('PGlite policy repository', () => {
  it('persists policy config overrides and resets to defaults', async () => {
    const { close, database, repository } = await openMigratedPolicyDb()
    try {
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
      expect(await database.select().from(policyConfig)).toHaveLength(1)
      await expect(repository.resetConfig()).resolves.toEqual(defaultPolicyConfig)
    } finally {
      await close()
    }
  })

  it('rejects an unknown config field instead of reporting an unchanged config as updated', async () => {
    const { close, repository } = await openMigratedPolicyDb()
    try {
      await expect(repository.updateConfig({ unknownSection: { staleLockHours: 9 } } as never))
        .rejects.toThrow('Unsupported policy config field: unknownSection')
      await expect(repository.getConfig()).resolves.toEqual(defaultPolicyConfig)
    } finally {
      await close()
    }
  })

  it('rejects malformed known values before the transaction, leaving a valid setting intact', async () => {
    const { close, repository } = await openMigratedPolicyDb()
    try {
      // A stored non-default setting must survive a rejected patch, not fall back to the default.
      const stored = await repository.updateConfig({ actionQueue: { staleLockHours: 9 } })
      expect(stored.actionQueue.staleLockHours).toBe(9)

      for (const [path, patch] of [
        ['actionQueue', { actionQueue: 3 }],
        ['actionQueue.staleLockHours', { actionQueue: { staleLockHours: 'bad' } }],
        ['scoring.applyCutoff', { scoring: { applyCutoff: 0 } }],
        ['manualReview.daytimeWindow.start', { manualReview: { daytimeWindow: { start: '9am' } } }],
        ['manualReview.nonOverridableTags', { manualReview: { nonOverridableTags: ['bogus'] } }],
      ] as const) {
        await expect(repository.updateConfig(patch as never))
          .rejects.toThrow(`Unsupported policy config value: ${path}`)
      }

      await expect(repository.getConfig()).resolves.toEqual({
        ...defaultPolicyConfig,
        actionQueue: { staleLockHours: 9 },
      })
    } finally {
      await close()
    }
  })

  it('atomically merges concurrent disjoint policy config patches', async () => {
    const { close, repository } = await openMigratedPolicyDb()
    try {
      await Promise.all([
        repository.updateConfig({ scoring: { applyCutoff: 7 } }),
        repository.updateConfig({ actionQueue: { staleLockHours: 3 } }),
      ])

      await expect(repository.getConfig()).resolves.toMatchObject({
        scoring: { applyCutoff: 7 },
        actionQueue: { staleLockHours: 3 },
      })
    } finally {
      await close()
    }
  })

  it('records and lists policy evidence without mutating the subject row', async () => {
    const { close, database, repository } = await openMigratedPolicyDb()
    try {
      const now = '2026-06-08T12:00:00.000Z'
      await seedCanonicalApplication(database, {
        id: 'application-versant-platform', companyName: 'Versant Media',
        roleTitle: 'Platform Engineering', workMode: 'remote', createdAt: now,
      })

      const before = await database
        .select()
        .from(applications)
        .where(eq(applications.id, 'application-versant-platform'))
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
      const after = await database
        .select()
        .from(applications)
        .where(eq(applications.id, 'application-versant-platform'))

      expect(evidence).toMatchObject({
        subjectType: 'application',
        subjectId: 'application-versant-platform',
        tag: 'explicit_user_approval',
        source: 'user',
      })
      expect(JSON.parse(evidence.payloadJson)).toEqual({ approvedBy: 'keni' })
      expect(await database.select().from(policyEvidence)).toHaveLength(1)
      expect(after).toEqual(before)
      await expect(
        repository.listEvidence({
          subjectType: 'application',
          subjectId: 'application-versant-platform',
        }),
      ).resolves.toEqual([evidence])
    } finally {
      await close()
    }
  })

  it('evaluates application submit gates from company policy and approval evidence', async () => {
    const { close, database, repository } = await openMigratedPolicyDb()
    try {
      await seedTikTokApplication(database)

      await expect(
        repository.evaluateApplication({
          applicationId: 'application-tiktok',
          attemptId: 'attempt-tiktok',
          outcome: 'submitted',
        }),
      ).resolves.toMatchObject({
        status: 'needs_review',
        action: 'hold_for_user_review',
        requiredEvidence: ['explicit_user_approval'],
      })
      await repository.recordEvidence({
        subjectType: 'application',
        subjectId: 'application-tiktok',
        tag: 'explicit_user_approval',
        source: 'user',
        note: 'User chose to spend a TikTok application slot.',
      })
      await expect(
        repository.evaluateApplication({
          applicationId: 'application-tiktok',
          attemptId: 'attempt-tiktok',
          outcome: 'submitted',
        }),
      ).resolves.toMatchObject({
        status: 'allow',
        action: 'allow_submit',
      })
    } finally {
      await close()
    }
  })

  it('computes scheduler-ready run windows without creating runs', async () => {
    const { close, database, repository } = await openMigratedPolicyDb()
    try {
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
      expect(await database.select().from(workflowRuns)).toHaveLength(0)
      expect(await database.select().from(workflowRunSteps)).toHaveLength(0)
    } finally {
      await close()
    }
  })
})
