import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  applicationLinks,
  applicationScores,
  applications,
  applicationWorkflowStates,
  companies,
  sources,
} from '../../db/schema'
import {
  createPgliteClient,
  migratePgliteDatabase,
  type PgliteClient,
  type PgliteDatabase,
} from '../../db/pglite'
import { createPglitePolicyRepository } from '../policy/policy.repository'
import { createPgliteActionQueueRepository } from './action-queue.repository'

const createdAt = '2026-06-04T16:00:00.000Z'

async function openMigratedActionQueueDb(dataDir?: string) {
  const client = await createPgliteClient(dataDir ? { dataDir } : {})
  const database = await migratePgliteDatabase(client)
  return {
    client,
    database,
    repository: createPgliteActionQueueRepository(database),
  }
}

async function closeClient(client: PgliteClient) {
  await client.close()
}

async function seedSampleActionQueueApplications(database: PgliteDatabase) {
  await database.insert(companies).values([
    {
      id: 'company-astranis',
      name: 'Astranis Space Technologies',
      normalizedName: 'astranis space technologies',
      websiteUrl: 'https://jobs.example.test/remediated/3b584e866326a6d1',
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    },
    {
      id: 'company-versant',
      name: 'Versant Media',
      normalizedName: 'versant media',
      websiteUrl: 'https://jobs.example.test/remediated/3d3842a361412418',
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    },
    {
      id: 'company-jobster',
      name: 'Jobster',
      normalizedName: 'jobster',
      websiteUrl: null,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    },
  ])

  await database.insert(sources).values([
    {
      id: 'source-linkedin',
      name: 'LinkedIn',
      accountHint: 'Profile 2 / candidate+f47504101f5f@example.test',
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    },
    {
      id: 'source-jobright',
      name: 'Jobright',
      accountHint: 'Profile 2 / candidate+f47504101f5f@example.test',
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    },
  ])

  await database.insert(applications).values([
    {
      id: 'application-astranis-backend',
      companyId: 'company-astranis',
      sourceId: 'source-linkedin',
      roleTitle: 'Software Engineer- Backend Intern (Fall 2026)',
      roleKind: 'internship',
      term: 'Fall 2026 internship',
      timingMode: 'unknown',
      termsJson: '[]',
      startDate: null,
      endDate: null,
      city: 'San Francisco',
      region: 'CA',
      country: 'US',
      workMode: 'onsite',
      locationRaw: 'San Francisco, CA / Onsite',
      status: 'needs_user_info',
      hasApplied: false,
      currentPriorityScore: 8,
      currentPriorityBand: 'high',
      currentResumeVariant: 'bachelor_dec_2027',
      notes: 'Needs Fall 2026 availability answers before submission.',
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    },
    {
      id: 'application-versant-platform',
      companyId: 'company-versant',
      sourceId: 'source-linkedin',
      roleTitle: 'Academic Year Internships: Platform Engineering',
      roleKind: 'internship',
      term: 'Sep. 14 2026-Apr. 16 2027',
      timingMode: 'unknown',
      termsJson: '[]',
      startDate: null,
      endDate: null,
      city: 'Universal City',
      region: 'CA',
      country: 'US',
      workMode: 'remote',
      locationRaw: 'Universal City, CA / Remote',
      status: 'queued',
      hasApplied: false,
      currentPriorityScore: 6,
      currentPriorityBand: 'medium',
      currentResumeVariant: 'bachelor_dec_2027',
      notes: 'Remote paid platform-engineering sample row.',
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    },
    {
      id: 'application-jobster-analytics',
      companyId: 'company-jobster',
      sourceId: 'source-jobright',
      roleTitle: 'Business Analytics Intern - Studentjob.ch',
      roleKind: 'internship',
      term: 'Internship',
      timingMode: 'unknown',
      termsJson: '[]',
      startDate: null,
      endDate: null,
      city: 'Bellevue',
      region: 'WA',
      country: 'US',
      workMode: 'onsite',
      locationRaw: 'Bellevue, WA / Onsite',
      status: 'not_fit',
      hasApplied: false,
      currentPriorityScore: 3,
      currentPriorityBand: 'skip',
      currentResumeVariant: null,
      notes: 'Below cutoff because the role is analytics rather than target SWE.',
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    },
  ])

  await database.insert(applicationLinks).values([
    {
      id: 'link-astranis-official',
      applicationId: 'application-astranis-backend',
      kind: 'official',
      label: 'official',
      url: 'https://jobs.example.test/remediated/f60a3102c158cd7c',
      externalId: '4681183006',
      isPrimary: true,
      discoveredAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    },
    {
      id: 'link-versant-official',
      applicationId: 'application-versant-platform',
      kind: 'official',
      label: 'official',
      url: 'https://jobs.example.test/remediated/41581ba03bdcb93e',
      externalId: '744000126408107',
      isPrimary: true,
      discoveredAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    },
    {
      id: 'link-jobster-source',
      applicationId: 'application-jobster-analytics',
      kind: 'source',
      label: 'source',
      url: 'https://jobs.example.test/remediated/8f573a16eeabe767',
      externalId: '6a2169a6338c01230511dfd7',
      isPrimary: true,
      discoveredAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    },
  ])

  await database.insert(applicationScores).values([
    {
      id: 'score-astranis-backend',
      applicationId: 'application-astranis-backend',
      score: 8,
      band: 'high',
      roleRelevance: 4,
      careerSignal: 3,
      cityWorkMode: 1,
      compensationLogistics: 0,
      penaltiesJson: '[]',
      rationale: 'Strong backend software internship at a respected space technology company.',
      rubricVersion: '2026-06-04',
      createdAt,
    },
    {
      id: 'score-versant-platform',
      applicationId: 'application-versant-platform',
      score: 6,
      band: 'medium',
      roleRelevance: 3,
      careerSignal: 1,
      cityWorkMode: 2,
      compensationLogistics: 1,
      penaltiesJson: '[-1]',
      rationale: 'Paid remote platform engineering role with academic-year logistics.',
      rubricVersion: '2026-06-04',
      createdAt,
    },
    {
      id: 'score-jobster-analytics',
      applicationId: 'application-jobster-analytics',
      score: 3,
      band: 'skip',
      roleRelevance: 1,
      careerSignal: 0,
      cityWorkMode: 1,
      compensationLogistics: 1,
      penaltiesJson: '[-2]',
      rationale: 'Business analytics scope is below the current SWE automation cutoff.',
      rubricVersion: '2026-06-04',
      createdAt,
    },
  ])
}

describe('PGlite action queue repository', () => {
  // Read-only repository: transaction rollback testing is not applicable.

  it('places queued applications at or above the cutoff in the apply-now action bucket', async () => {
    const { client, database, repository } = await openMigratedActionQueueDb()
    try {
      await seedSampleActionQueueApplications(database)

      const result = await repository.listActionQueue({ actionBucket: 'apply_now' })

      expect(result).toMatchObject({
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
        actionBucketCounts: {
          apply_now: 1,
        },
      })
      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        id: 'application-versant-platform',
        companyName: 'Versant Media',
        roleTitle: 'Academic Year Internships: Platform Engineering',
        status: 'queued',
        currentPriorityScore: 6,
        actionBucket: 'apply_now',
        nextAction: 'apply_now',
        reason: 'Queued score 6 meets policy cutoff 6.',
        primaryLink: {
          label: 'official',
          url: 'https://jobs.example.test/remediated/41581ba03bdcb93e',
        },
      })
    } finally {
      await closeClient(client)
    }
  })

  it('places queued applications below the cutoff in the skip-below-cutoff action bucket', async () => {
    const { client, database, repository } = await openMigratedActionQueueDb()
    try {
      await seedSampleActionQueueApplications(database)
      await database
        .update(applications)
        .set({ status: 'queued' })
        .where(eq(applications.id, 'application-jobster-analytics'))

      const result = await repository.listActionQueue({ actionBucket: 'skip_below_cutoff' })

      expect(result).toMatchObject({
        total: 1,
        actionBucketCounts: {
          skip_below_cutoff: 1,
        },
      })
      expect(result.items[0]).toMatchObject({
        id: 'application-jobster-analytics',
        status: 'queued',
        currentPriorityScore: 3,
        actionBucket: 'skip_below_cutoff',
        nextAction: 'skip_below_cutoff',
        reason: 'Queued score 3 is below policy cutoff 6.',
      })
    } finally {
      await closeClient(client)
    }
  })

  it('keeps queued applications without scores visible for user review', async () => {
    const { client, database, repository } = await openMigratedActionQueueDb()
    try {
      await seedSampleActionQueueApplications(database)
      await database
        .update(applications)
        .set({ currentPriorityScore: null, currentPriorityBand: null })
        .where(eq(applications.id, 'application-versant-platform'))

      const result = await repository.listActionQueue({ actionBucket: 'user_review_required' })

      expect(result).toMatchObject({
        total: 1,
        actionBucketCounts: {
          user_review_required: 1,
        },
      })
      expect(result.items[0]).toMatchObject({
        id: 'application-versant-platform',
        status: 'queued',
        currentPriorityScore: null,
        actionBucket: 'user_review_required',
        nextAction: 'user_review_required',
        reason: 'Queued application has no priority score; record a score before applying.',
      })
    } finally {
      await closeClient(client)
    }
  })

  it('uses policy cutoff overrides when deriving action queue buckets', async () => {
    const { client, database, repository } = await openMigratedActionQueueDb()
    try {
      await seedSampleActionQueueApplications(database)
      await createPglitePolicyRepository(database).updateConfig({
        scoring: {
          applyCutoff: 7,
        },
      })

      const result = await repository.listActionQueue({ actionBucket: 'skip_below_cutoff' })

      expect(result.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'application-versant-platform',
            currentPriorityScore: 6,
            actionBucket: 'skip_below_cutoff',
            reason: 'Queued score 6 is below policy cutoff 7.',
          }),
        ]),
      )
    } finally {
      await closeClient(client)
    }
  })

  it('places applications with structured missing info in the needs-user-info action bucket', async () => {
    const { client, database } = await openMigratedActionQueueDb()
    try {
      await seedSampleActionQueueApplications(database)
      await database.insert(applicationWorkflowStates).values({
        applicationId: 'application-versant-platform',
        missingUserInfo: 'Fall 2026 start and end availability',
        createdAt: '2026-06-04T16:00:00.000Z',
        updatedAt: '2026-06-04T16:00:00.000Z',
      })

      const repository = createPgliteActionQueueRepository(database, {
        now: () => new Date('2026-06-04T22:00:00.000Z'),
      })
      const result = await repository.listActionQueue({ actionBucket: 'needs_user_info' })

      expect(result).toMatchObject({
        total: 2,
        actionBucketCounts: {
          needs_user_info: 2,
        },
      })
      expect(result.items.map((item) => item.id)).toEqual([
        'application-astranis-backend',
        'application-versant-platform',
      ])
      expect(result.items[1]).toMatchObject({
        id: 'application-versant-platform',
        actionBucket: 'needs_user_info',
        nextAction: 'needs_user_info',
        reason: 'Missing user info: Fall 2026 start and end availability.',
      })
    } finally {
      await closeClient(client)
    }
  })

  it('does not duplicate punctuation in structured missing-info reasons', async () => {
    const { client, database, repository } = await openMigratedActionQueueDb()
    try {
      await seedSampleActionQueueApplications(database)
      await database.insert(applicationWorkflowStates).values({
        applicationId: 'application-versant-platform',
        missingUserInfo: 'Explicit user confirmation is required before any real submission.',
        createdAt: '2026-06-04T16:00:00.000Z',
        updatedAt: '2026-06-04T16:00:00.000Z',
      })

      const result = await repository.listActionQueue({ actionBucket: 'needs_user_info' })

      expect(result.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'application-versant-platform',
            reason:
              'Missing user info: Explicit user confirmation is required before any real submission.',
          }),
        ]),
      )
    } finally {
      await closeClient(client)
    }
  })

  it('places old overridable review holds in the manual-review-pickup action bucket', async () => {
    const { client, database } = await openMigratedActionQueueDb()
    try {
      await seedSampleActionQueueApplications(database)
      await database
        .update(applications)
        .set({ status: 'ready_for_review' })
        .where(eq(applications.id, 'application-versant-platform'))
      await database.insert(applicationWorkflowStates).values({
        applicationId: 'application-versant-platform',
        holdStartedAt: '2000-01-01T00:00:00.000Z',
        manualReviewKind: 'overridable',
        createdAt: '2026-06-04T16:00:00.000Z',
        updatedAt: '2026-06-04T16:00:00.000Z',
      })

      const repository = createPgliteActionQueueRepository(database, {
        now: () => new Date('2026-06-04T20:00:00.000Z'),
      })
      const result = await repository.listActionQueue({ actionBucket: 'manual_review_pickup' })

      expect(result).toMatchObject({
        total: 1,
        actionBucketCounts: {
          manual_review_pickup: 1,
        },
      })
      expect(result.items[0]).toMatchObject({
        id: 'application-versant-platform',
        status: 'ready_for_review',
        actionBucket: 'manual_review_pickup',
        nextAction: 'manual_review_pickup',
        reason: 'Manual review hold is overridable and eligible for pickup after 6 hours.',
      })
    } finally {
      await closeClient(client)
    }
  })

  it('keeps expired overridable review holds out of pickup outside the policy window', async () => {
    const { client, database } = await openMigratedActionQueueDb()
    try {
      await seedSampleActionQueueApplications(database)
      await database
        .update(applications)
        .set({ status: 'ready_for_review' })
        .where(eq(applications.id, 'application-versant-platform'))
      await database.insert(applicationWorkflowStates).values({
        applicationId: 'application-versant-platform',
        holdStartedAt: '2026-06-04T10:00:00.000Z',
        manualReviewKind: 'overridable',
        createdAt: '2026-06-04T10:00:00.000Z',
        updatedAt: '2026-06-04T10:00:00.000Z',
      })

      const repository = createPgliteActionQueueRepository(database, {
        now: () => new Date('2026-06-04T15:00:00.000Z'),
      })
      const result = await repository.listActionQueue({ actionBucket: 'manual_review_pickup' })

      expect(result.items).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'application-versant-platform',
          }),
        ]),
      )
    } finally {
      await closeClient(client)
    }
  })

  it('places non-overridable review holds in the user-review-required action bucket', async () => {
    const { client, database, repository } = await openMigratedActionQueueDb()
    try {
      await seedSampleActionQueueApplications(database)
      await database
        .update(applications)
        .set({ status: 'ready_for_review' })
        .where(eq(applications.id, 'application-versant-platform'))
      await database.insert(applicationWorkflowStates).values({
        applicationId: 'application-versant-platform',
        holdStartedAt: '2000-01-01T00:00:00.000Z',
        manualReviewKind: 'non_overridable',
        createdAt: '2026-06-04T16:00:00.000Z',
        updatedAt: '2026-06-04T16:00:00.000Z',
      })

      const result = await repository.listActionQueue({ actionBucket: 'user_review_required' })

      expect(result).toMatchObject({
        total: 1,
        actionBucketCounts: {
          user_review_required: 1,
        },
      })
      expect(result.items[0]).toMatchObject({
        id: 'application-versant-platform',
        status: 'ready_for_review',
        actionBucket: 'user_review_required',
        nextAction: 'user_review_required',
        reason: 'Manual review hold is non-overridable.',
      })
    } finally {
      await closeClient(client)
    }
  })

  it('places old in-progress locks in the stale-lock-recovery action bucket', async () => {
    const { client, database, repository } = await openMigratedActionQueueDb()
    try {
      await seedSampleActionQueueApplications(database)
      await database
        .update(applications)
        .set({ status: 'in_progress' })
        .where(eq(applications.id, 'application-versant-platform'))
      await database.insert(applicationWorkflowStates).values({
        applicationId: 'application-versant-platform',
        lockStartedAt: '2000-01-01T00:00:00.000Z',
        createdAt: '2026-06-04T16:00:00.000Z',
        updatedAt: '2026-06-04T16:00:00.000Z',
      })

      const result = await repository.listActionQueue({ actionBucket: 'stale_lock_recovery' })

      expect(result).toMatchObject({
        total: 1,
        actionBucketCounts: {
          stale_lock_recovery: 1,
        },
      })
      expect(result.items[0]).toMatchObject({
        id: 'application-versant-platform',
        status: 'in_progress',
        actionBucket: 'stale_lock_recovery',
        nextAction: 'stale_lock_recovery',
        reason: 'In-progress lock is older than 2 hours.',
      })
    } finally {
      await closeClient(client)
    }
  })

  it('places blocker statuses in the blocked action bucket', async () => {
    const { client, database, repository } = await openMigratedActionQueueDb()
    try {
      await seedSampleActionQueueApplications(database)

      const result = await repository.listActionQueue({ actionBucket: 'blocked' })

      expect(result).toMatchObject({
        total: 1,
        actionBucketCounts: {
          blocked: 1,
        },
      })
      expect(result.items[0]).toMatchObject({
        id: 'application-jobster-analytics',
        status: 'not_fit',
        actionBucket: 'blocked',
        nextAction: 'blocked',
        reason: 'Application status is not_fit.',
      })
    } finally {
      await closeClient(client)
    }
  })

  it('places applications with structured blocker reasons in the blocked action bucket', async () => {
    const { client, database, repository } = await openMigratedActionQueueDb()
    try {
      await seedSampleActionQueueApplications(database)
      await database
        .update(applications)
        .set({ status: 'submitted' })
        .where(eq(applications.id, 'application-jobster-analytics'))
      await database.insert(applicationWorkflowStates).values({
        applicationId: 'application-versant-platform',
        blockerReason: 'SmartRecruiters validation error',
        createdAt: '2026-06-04T16:00:00.000Z',
        updatedAt: '2026-06-04T16:00:00.000Z',
      })

      const result = await repository.listActionQueue({ actionBucket: 'blocked' })

      expect(result).toMatchObject({
        total: 1,
        actionBucketCounts: {
          blocked: 1,
        },
      })
      expect(result.items[0]).toMatchObject({
        id: 'application-versant-platform',
        status: 'queued',
        actionBucket: 'blocked',
        nextAction: 'blocked',
        reason: 'Blocked: SmartRecruiters validation error.',
      })
    } finally {
      await closeClient(client)
    }
  })

  it('orders unfiltered action queue rows by action bucket before score', async () => {
    const { client, database, repository } = await openMigratedActionQueueDb()
    try {
      await seedSampleActionQueueApplications(database)

      const result = await repository.listActionQueue()

      expect(result.items.map((item) => item.id)).toEqual([
        'application-versant-platform',
        'application-astranis-backend',
        'application-jobster-analytics',
      ])
      expect(result.items.map((item) => item.actionBucket)).toEqual([
        'apply_now',
        'needs_user_info',
        'blocked',
      ])
    } finally {
      await closeClient(client)
    }
  })

  it('reads the same action queue across on-disk close and reopen', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-queue-pglite-'))
    try {
      const first = await openMigratedActionQueueDb(dataDir)
      try {
        await seedSampleActionQueueApplications(first.database)
        await expect(first.repository.listActionQueue({ actionBucket: 'apply_now' })).resolves.toMatchObject({
          total: 1,
          items: [
            {
              id: 'application-versant-platform',
              actionBucket: 'apply_now',
              reason: 'Queued score 6 meets policy cutoff 6.',
            },
          ],
        })
      } finally {
        await closeClient(first.client)
      }

      const second = await openMigratedActionQueueDb(dataDir)
      try {
        await expect(second.repository.listActionQueue({ actionBucket: 'apply_now' })).resolves.toMatchObject({
          total: 1,
          items: [
            {
              id: 'application-versant-platform',
              actionBucket: 'apply_now',
              reason: 'Queued score 6 meets policy cutoff 6.',
            },
          ],
        })
      } finally {
        await closeClient(second.client)
      }
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('returns stable results for concurrent listActionQueue calls', async () => {
    const { client, database, repository } = await openMigratedActionQueueDb()
    try {
      await seedSampleActionQueueApplications(database)

      const [first, second] = await Promise.all([
        repository.listActionQueue(),
        repository.listActionQueue(),
      ])

      expect(first).toEqual(second)
      expect(first.items.map((item) => item.id)).toEqual([
        'application-versant-platform',
        'application-astranis-backend',
        'application-jobster-analytics',
      ])
    } finally {
      await closeClient(client)
    }
  })
})
