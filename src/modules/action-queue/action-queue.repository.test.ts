import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { applications } from '../../db/schema'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { seedSampleApplications } from '../applications/application.fixtures'
import { createSqlitePolicyRepository } from '../policy/policy.repository'
import { createSqliteActionQueueRepository } from './action-queue.repository'

describe('SQLite action queue repository', () => {
  it('places queued applications at or above the cutoff in the apply-now action bucket', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteActionQueueRepository(database)
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
  })

  it('places queued applications below the cutoff in the skip-below-cutoff action bucket', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    database
      .update(applications)
      .set({ status: 'queued' })
      .where(eq(applications.id, 'application-jobster-analytics'))
      .run()

    const repository = createSqliteActionQueueRepository(database)
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
  })

  it('keeps queued applications without scores visible for user review', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    database
      .update(applications)
      .set({ currentPriorityScore: null, currentPriorityBand: null })
      .where(eq(applications.id, 'application-versant-platform'))
      .run()

    const repository = createSqliteActionQueueRepository(database)
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
  })

  it('uses policy cutoff overrides when deriving action queue buckets', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    await createSqlitePolicyRepository(database).updateConfig({
      scoring: {
        applyCutoff: 7,
      },
    })

    const repository = createSqliteActionQueueRepository(database)
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
  })

  it('places applications with structured missing info in the needs-user-info action bucket', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    sqlite
      .prepare(
        `
          insert into application_workflow_states (
            application_id,
            missing_user_info,
            created_at,
            updated_at
          ) values (?, ?, ?, ?)
        `,
      )
      .run(
        'application-versant-platform',
        'Fall 2026 start and end availability',
        '2026-06-04T16:00:00.000Z',
        '2026-06-04T16:00:00.000Z',
      )

    const repository = createSqliteActionQueueRepository(database, {
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
  })

  it('does not duplicate punctuation in structured missing-info reasons', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    sqlite
      .prepare(
        `
          insert into application_workflow_states (
            application_id,
            missing_user_info,
            created_at,
            updated_at
          ) values (?, ?, ?, ?)
        `,
      )
      .run(
        'application-versant-platform',
        'Explicit user confirmation is required before any real submission.',
        '2026-06-04T16:00:00.000Z',
        '2026-06-04T16:00:00.000Z',
      )

    const repository = createSqliteActionQueueRepository(database)
    const result = await repository.listActionQueue({ actionBucket: 'needs_user_info' })

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'application-versant-platform',
          reason: 'Missing user info: Explicit user confirmation is required before any real submission.',
        }),
      ]),
    )
  })

  it('places old overridable review holds in the manual-review-pickup action bucket', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    database
      .update(applications)
      .set({ status: 'ready_for_review' })
      .where(eq(applications.id, 'application-versant-platform'))
      .run()
    sqlite
      .prepare(
        `
          insert into application_workflow_states (
            application_id,
            hold_started_at,
            manual_review_kind,
            created_at,
            updated_at
          ) values (?, ?, ?, ?, ?)
        `,
      )
      .run(
        'application-versant-platform',
        '2000-01-01T00:00:00.000Z',
        'overridable',
        '2026-06-04T16:00:00.000Z',
        '2026-06-04T16:00:00.000Z',
      )

    const repository = createSqliteActionQueueRepository(database, {
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
  })

  it('keeps expired overridable review holds out of pickup outside the policy window', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    database
      .update(applications)
      .set({ status: 'ready_for_review' })
      .where(eq(applications.id, 'application-versant-platform'))
      .run()
    sqlite
      .prepare(
        `
          insert into application_workflow_states (
            application_id,
            hold_started_at,
            manual_review_kind,
            created_at,
            updated_at
          ) values (?, ?, ?, ?, ?)
        `,
      )
      .run(
        'application-versant-platform',
        '2026-06-04T10:00:00.000Z',
        'overridable',
        '2026-06-04T10:00:00.000Z',
        '2026-06-04T10:00:00.000Z',
      )

    const repository = createSqliteActionQueueRepository(database, {
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
  })

  it('places non-overridable review holds in the user-review-required action bucket', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    database
      .update(applications)
      .set({ status: 'ready_for_review' })
      .where(eq(applications.id, 'application-versant-platform'))
      .run()
    sqlite
      .prepare(
        `
          insert into application_workflow_states (
            application_id,
            hold_started_at,
            manual_review_kind,
            created_at,
            updated_at
          ) values (?, ?, ?, ?, ?)
        `,
      )
      .run(
        'application-versant-platform',
        '2000-01-01T00:00:00.000Z',
        'non_overridable',
        '2026-06-04T16:00:00.000Z',
        '2026-06-04T16:00:00.000Z',
      )

    const repository = createSqliteActionQueueRepository(database)
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
  })

  it('places old in-progress locks in the stale-lock-recovery action bucket', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    database
      .update(applications)
      .set({ status: 'in_progress' })
      .where(eq(applications.id, 'application-versant-platform'))
      .run()
    sqlite
      .prepare(
        `
          insert into application_workflow_states (
            application_id,
            lock_started_at,
            created_at,
            updated_at
          ) values (?, ?, ?, ?)
        `,
      )
      .run(
        'application-versant-platform',
        '2000-01-01T00:00:00.000Z',
        '2026-06-04T16:00:00.000Z',
        '2026-06-04T16:00:00.000Z',
      )

    const repository = createSqliteActionQueueRepository(database)
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
  })

  it('places blocker statuses in the blocked action bucket', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteActionQueueRepository(database)
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
  })

  it('places applications with structured blocker reasons in the blocked action bucket', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    database
      .update(applications)
      .set({ status: 'submitted' })
      .where(eq(applications.id, 'application-jobster-analytics'))
      .run()
    sqlite
      .prepare(
        `
          insert into application_workflow_states (
            application_id,
            blocker_reason,
            created_at,
            updated_at
          ) values (?, ?, ?, ?)
        `,
      )
      .run(
        'application-versant-platform',
        'SmartRecruiters validation error',
        '2026-06-04T16:00:00.000Z',
        '2026-06-04T16:00:00.000Z',
      )

    const repository = createSqliteActionQueueRepository(database)
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
  })

  it('orders unfiltered action queue rows by action bucket before score', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteActionQueueRepository(database)
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
  })
})
