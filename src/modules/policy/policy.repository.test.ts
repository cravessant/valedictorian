import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultPolicyConfig } from 'sparxie'
import { eq } from 'drizzle-orm'
import {
  applications,
  companies,
  policyConfig,
  policyEvidence,
  sources,
  workflowRuns,
  workflowRunSteps,
} from '../../db/schema'
import {
  createPgliteClient,
  migratePgliteDatabase,
  type PgliteClient,
  type PgliteDatabase,
} from '../../db/pglite'
import { createPglitePolicyRepository } from './policy.repository'

const passedVerificationReceiptPayload = {
  version: 1,
  scope: 'final_review',
  status: 'passed',
  verified: ['resume_attachment', 'contact_info', 'education', 'work_authorization'],
  unresolved: [],
  evidence: 'Final review page showed correct material fields.',
}

async function openMigratedPolicyDb(dataDir?: string) {
  const client = await createPgliteClient(dataDir ? { dataDir } : {})
  const database = await migratePgliteDatabase(client)
  return {
    client,
    database,
    repository: createPglitePolicyRepository(database),
  }
}

async function closeClient(client: PgliteClient) {
  await client.close()
}

async function seedTikTokApplication(database: PgliteDatabase) {
  const now = '2026-06-08T12:00:00.000Z'
  await database.insert(companies).values({
    id: 'company-tiktok',
    name: 'TikTok',
    normalizedName: 'tiktok',
    websiteUrl: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  await database.insert(sources).values({
    id: 'source-linkedin',
    name: 'LinkedIn',
    accountHint: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  await database.insert(applications).values({
    id: 'application-tiktok',
    companyId: 'company-tiktok',
    sourceId: 'source-linkedin',
    roleTitle: 'Software Engineer Intern',
    roleKind: 'internship',
    term: null,
    timingMode: 'unknown',
    termsJson: '[]',
    startDate: null,
    endDate: null,
    city: null,
    region: null,
    country: 'US',
    workMode: 'remote',
    locationRaw: null,
    status: 'queued',
    hasApplied: false,
    currentPriorityScore: null,
    currentPriorityBand: null,
    currentResumeVariant: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
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

describe('PGlite policy repository', () => {
  it('persists policy config overrides and resets to defaults', async () => {
    const { client, database, repository } = await openMigratedPolicyDb()
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
      await closeClient(client)
    }
  })

  it('persists policy config across on-disk close and reopen', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-pglite-'))
    try {
      const first = await openMigratedPolicyDb(dataDir)
      try {
        await first.repository.updateConfig({
          scoring: { applyCutoff: 9 },
        })
      } finally {
        await closeClient(first.client)
      }

      const second = await openMigratedPolicyDb(dataDir)
      try {
        await expect(second.repository.getConfig()).resolves.toMatchObject({
          scoring: { applyCutoff: 9 },
        })
      } finally {
        await closeClient(second.client)
      }
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('atomically merges concurrent disjoint policy config patches', async () => {
    const { client, repository } = await openMigratedPolicyDb()
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
      await closeClient(client)
    }
  })

  it('records and lists policy evidence without mutating the subject row', async () => {
    const { client, database, repository } = await openMigratedPolicyDb()
    try {
      const now = '2026-06-08T12:00:00.000Z'
      await database.insert(companies).values({
        id: 'company-versant',
        name: 'Versant Media',
        normalizedName: 'versant media',
        websiteUrl: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      await database.insert(sources).values({
        id: 'source-linkedin',
        name: 'LinkedIn',
        accountHint: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      await database.insert(applications).values({
        id: 'application-versant-platform',
        companyId: 'company-versant',
        sourceId: 'source-linkedin',
        roleTitle: 'Platform Engineering',
        roleKind: 'internship',
        term: null,
        timingMode: 'unknown',
        termsJson: '[]',
        startDate: null,
        endDate: null,
        city: null,
        region: null,
        country: 'US',
        workMode: 'remote',
        locationRaw: null,
        status: 'queued',
        hasApplied: false,
        currentPriorityScore: null,
        currentPriorityBand: null,
        currentResumeVariant: null,
        notes: 'unchanged',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
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
      await closeClient(client)
    }
  })

  it('evaluates application submit gates from company policy and approval evidence', async () => {
    const { client, database, repository } = await openMigratedPolicyDb()
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
      await closeClient(client)
    }
  })

  it('computes scheduler-ready run windows without creating runs', async () => {
    const { client, database, repository } = await openMigratedPolicyDb()
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
      await closeClient(client)
    }
  })
})
