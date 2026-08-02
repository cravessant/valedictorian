import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  applicationScores,
  applicationWorkflowStates,
  pursuitLinks,
} from '@sparxie/valedictorian-local-runtime/testing/db/schema'
import {
  type PgliteDatabase,
} from '@sparxie/valedictorian-local-runtime/database'
import { useResettablePgliteTestDatabase } from '../../test/pglite-test-owner'
import { createPglitePolicyRepository } from '@sparxie/valedictorian-local-runtime/testing/modules/policy/policy.repository'
import { seedCanonicalApplication } from '../../test-fixtures/canonical-application.fixture'
import { createPgliteActionQueueRepository } from '@sparxie/valedictorian-local-runtime/testing/modules/action-queue/action-queue.repository'

const createdAt = '2026-06-04T16:00:00.000Z'
const resettableDatabase = useResettablePgliteTestDatabase()

async function openMigratedActionQueueDb() {
  const database = resettableDatabase()
  return { client: null, database, repository: createPgliteActionQueueRepository(database) }
}

async function closeClient(_client: null) {
}

async function seedSampleActionQueueApplications(database: PgliteDatabase) {
  await seedCanonicalApplication(database, {
    id: 'application-astranis-backend', companyName: 'Astranis Space Technologies',
    roleTitle: 'Software Engineer- Backend Intern (Fall 2026)', sourceName: 'LinkedIn',
    operationalStatus: 'needs_user_info', workMode: 'onsite',
    location: { city: 'San Francisco', region: 'CA', country: 'US', display: 'San Francisco, CA / Onsite' },
    createdAt,
  })
  await seedCanonicalApplication(database, {
    id: 'application-versant-platform', companyName: 'Versant Media',
    roleTitle: 'Academic Year Internships: Platform Engineering', sourceName: 'LinkedIn',
    operationalStatus: 'queued', workMode: 'remote',
    location: { city: 'Universal City', region: 'CA', country: 'US', display: 'Universal City, CA / Remote' },
    createdAt,
  })
  await seedCanonicalApplication(database, {
    id: 'application-jobster-analytics', companyName: 'Jobster',
    roleTitle: 'Business Analytics Intern - Studentjob.ch', sourceName: 'Jobright',
    operationalStatus: 'not_fit', workMode: 'onsite',
    location: { city: 'Bellevue', region: 'WA', country: 'US', display: 'Bellevue, WA / Onsite' },
    createdAt,
  })

  await database.insert(pursuitLinks).values([
    {
      id: 'link-astranis-official',
      applicationId: 'application-astranis-backend',
      kind: 'official',
      label: 'official',
      url: 'https://jobs.example.test/remediated/f60a3102c158cd7c',
      isPrimary: true,
      createdAt,
    },
    {
      id: 'link-versant-official',
      applicationId: 'application-versant-platform',
      kind: 'official',
      label: 'official',
      url: 'https://jobs.example.test/remediated/41581ba03bdcb93e',
      isPrimary: true,
      createdAt,
    },
    {
      id: 'link-jobster-source',
      applicationId: 'application-jobster-analytics',
      kind: 'source',
      label: 'source',
      url: 'https://jobs.example.test/remediated/8f573a16eeabe767',
      isPrimary: true,
      createdAt,
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

describe.sequential('PGlite action queue repository', () => {
  // Read-only repository: transaction rollback testing is not applicable.

  it('places queued applications into apply-now and skip-below-cutoff buckets from one seed', async () => {
    const { database, repository } = await openMigratedActionQueueDb()
    await seedSampleActionQueueApplications(database)

    const applyNow = await repository.listActionQueue({ actionBucket: 'apply_now' })
    expect(applyNow).toMatchObject({
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
      actionBucketCounts: {
        apply_now: 1,
      },
    })
    expect(applyNow.items).toHaveLength(1)
    expect(applyNow.items[0]).toMatchObject({
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

    await database
      .update(applicationWorkflowStates)
      .set({ operationalStatus: 'queued' })
      .where(eq(applicationWorkflowStates.applicationId, 'application-jobster-analytics'))

    const skipBelow = await repository.listActionQueue({ actionBucket: 'skip_below_cutoff' })
    expect(skipBelow).toMatchObject({
      total: 1,
      actionBucketCounts: {
        skip_below_cutoff: 1,
      },
    })
    expect(skipBelow.items[0]).toMatchObject({
      id: 'application-jobster-analytics',
      status: 'queued',
      currentPriorityScore: 3,
      actionBucket: 'skip_below_cutoff',
      nextAction: 'skip_below_cutoff',
      reason: 'Queued score 3 is below policy cutoff 6.',
    })
  })

  it('keeps queued applications without scores visible for user review', async () => {
    const { client, database, repository } = await openMigratedActionQueueDb()
    try {
      await seedSampleActionQueueApplications(database)
      await database
        .delete(applicationScores)
        .where(eq(applicationScores.applicationId, 'application-versant-platform'))

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
      await database.update(applicationWorkflowStates).set({
        missingUserInfo: 'Fall 2026 start and end availability',
        updatedAt: '2026-06-04T16:00:00.000Z',
      }).where(eq(applicationWorkflowStates.applicationId, 'application-versant-platform'))

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
      await database.update(applicationWorkflowStates).set({
        missingUserInfo: 'Explicit user confirmation is required before any real submission.',
        updatedAt: '2026-06-04T16:00:00.000Z',
      }).where(eq(applicationWorkflowStates.applicationId, 'application-versant-platform'))

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
        .update(applicationWorkflowStates)
        .set({ operationalStatus: 'ready_for_review',
        holdStartedAt: '2000-01-01T00:00:00.000Z',
        manualReviewKind: 'overridable',
        updatedAt: '2026-06-04T16:00:00.000Z',
        })
        .where(eq(applicationWorkflowStates.applicationId, 'application-versant-platform'))

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
        .update(applicationWorkflowStates)
        .set({ operationalStatus: 'ready_for_review',
        holdStartedAt: '2026-06-04T10:00:00.000Z',
        manualReviewKind: 'overridable',
        updatedAt: '2026-06-04T10:00:00.000Z',
        })
        .where(eq(applicationWorkflowStates.applicationId, 'application-versant-platform'))

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
        .update(applicationWorkflowStates)
        .set({ operationalStatus: 'ready_for_review',
        holdStartedAt: '2000-01-01T00:00:00.000Z',
        manualReviewKind: 'non_overridable',
        updatedAt: '2026-06-04T16:00:00.000Z',
        })
        .where(eq(applicationWorkflowStates.applicationId, 'application-versant-platform'))

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
        .update(applicationWorkflowStates)
        .set({ operationalStatus: 'in_progress',
        lockStartedAt: '2000-01-01T00:00:00.000Z',
        updatedAt: '2026-06-04T16:00:00.000Z',
        })
        .where(eq(applicationWorkflowStates.applicationId, 'application-versant-platform'))

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
        .update(applicationWorkflowStates)
        .set({ operationalStatus: 'submitted' })
        .where(eq(applicationWorkflowStates.applicationId, 'application-jobster-analytics'))
      await database.update(applicationWorkflowStates).set({
        blockerReason: 'SmartRecruiters validation error',
        updatedAt: '2026-06-04T16:00:00.000Z',
      }).where(eq(applicationWorkflowStates.applicationId, 'application-versant-platform'))

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
