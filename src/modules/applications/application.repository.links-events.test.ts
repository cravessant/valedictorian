import {
  applicationEvents,
  applicationLinks,
  applicationWorkflowStates,
  applications,
} from '../../db/schema'
import { eq } from 'drizzle-orm'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createPgliteClient, migratePgliteDatabase } from '../../db/pglite'
import { seedSampleApplications } from './application.fixtures'
import { createPgliteApplicationRepository } from './application.repository'

async function createTestDatabase() {
  const client = await createPgliteClient()
  onTestFinished(() => client.close())
  return migratePgliteDatabase(client)
}

describe('PGlite application repository links, events, and workflow state', () => {
  it('lists application events newest first with pagination', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    await database
      .insert(applicationEvents)
      .values([
        {
          id: 'event-old',
          applicationId: 'application-versant-platform',
          type: 'note',
          message: 'Older note.',
          payloadJson: '{}',
          actor: 'agent',
          createdAt: '2026-06-04T16:00:00.000Z',
        },
        {
          id: 'event-new',
          applicationId: 'application-versant-platform',
          type: 'status_updated',
          message: 'Newer status.',
          payloadJson: '{}',
          actor: 'agent',
          createdAt: '2026-06-04T17:00:00.000Z',
        },
      ])


    const repository = createPgliteApplicationRepository(database)
    await expect(
      repository.listApplicationEvents({
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
          id: 'event-new',
          message: 'Newer status.',
        },
      ],
    })
  })

  it('upserts workflow state and clears nullable fields', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)

    await repository.updateApplicationWorkflow({
      applicationId: 'application-versant-platform',
      missingUserInfo: 'Fall 2026 dates',
      blockerReason: 'SmartRecruiters validation error',
      manualReviewKind: 'overridable',
    })
    await repository.updateApplicationWorkflow({
      applicationId: 'application-versant-platform',
      blockerReason: null,
    })

    expect(
      await database
        .select()
        .from(applicationWorkflowStates)
        .where(eq(applicationWorkflowStates.applicationId, 'application-versant-platform'))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      applicationId: 'application-versant-platform',
      missingUserInfo: 'Fall 2026 dates',
      blockerReason: null,
      manualReviewKind: 'overridable',
    })
    expect(
      (await database
        .select()
        .from(applicationEvents)
        .where(eq(applicationEvents.applicationId, 'application-versant-platform')))
        .map((event) => event.type),
    ).toEqual(['workflow_updated', 'workflow_updated'])
  })

  it('rejects invalid workflow timestamps while allowing null clears', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)

    await expect(
      repository.updateApplicationWorkflow({
        applicationId: 'application-versant-platform',
        lockStartedAt: 'tomorrow-ish',
      }),
    ).rejects.toThrow('Invalid lockStartedAt: tomorrow-ish')
    await expect(
      repository.updateApplicationWorkflow({
        applicationId: 'application-versant-platform',
        lockStartedAt: null,
      }),
    ).resolves.toMatchObject({
      id: 'application-versant-platform',
    })
  })

  it('creates and updates links while preserving a single primary link', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
    const createdLink = await repository.createApplicationLink({
      applicationId: 'application-versant-platform',
      kind: 'source',
      label: 'LinkedIn',
      url: 'https://www.linkedin.com/jobs/view/versant',
      isPrimary: true,
    })

    expect(
      (await database
        .select()
        .from(applicationLinks)
        .where(eq(applicationLinks.applicationId, 'application-versant-platform')))
        .filter((link) => link.isPrimary),
    ).toHaveLength(1)
    expect(await repository.getApplication('application-versant-platform')).toMatchObject({
      primaryLink: {
        label: 'LinkedIn',
        url: 'https://www.linkedin.com/jobs/view/versant',
      },
    })

    await repository.updateApplicationLink({
      applicationId: 'application-versant-platform',
      linkId: createdLink.id,
      label: 'LinkedIn Easy Apply',
      url: 'https://www.linkedin.com/jobs/view/versant-updated',
    })

    expect(
      await database.select().from(applicationLinks).where(eq(applicationLinks.id, createdLink.id)).limit(1).then(([row]) => row),
    ).toMatchObject({
      label: 'LinkedIn Easy Apply',
      url: 'https://www.linkedin.com/jobs/view/versant-updated',
      isPrimary: true,
    })
  })

  it('lists active application links with primary links first', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
    const sourceLink = await repository.createApplicationLink({
      applicationId: 'application-versant-platform',
      kind: 'source',
      label: 'LinkedIn',
      url: 'https://www.linkedin.com/jobs/view/versant',
      isPrimary: true,
    })
    await repository.createApplicationLink({
      applicationId: 'application-versant-platform',
      kind: 'source',
      label: 'Archived source',
      url: 'https://www.linkedin.com/jobs/view/versant-archived',
    })
    await repository.updateApplicationLink({
      applicationId: 'application-versant-platform',
      linkId: sourceLink.id,
      isPrimary: true,
    })
    await repository.updateApplicationLink({
      applicationId: 'application-versant-platform',
      linkId: sourceLink.id,
      label: 'LinkedIn primary',
    })

    const archived = await database
      .select()
      .from(applicationLinks)
      .where(eq(applicationLinks.label, 'Archived source'))
      .limit(1).then(([row]) => row)

    if (!archived) {
      throw new Error('Expected archived link fixture')
    }

    await repository.updateApplicationLink({
      applicationId: 'application-versant-platform',
      linkId: archived.id,
      archived: true,
    })

    await expect(
      repository.listApplicationLinks({ applicationId: 'application-versant-platform' }),
    ).resolves.toMatchObject({
      total: 2,
      items: [
        {
          id: sourceLink.id,
          label: 'LinkedIn primary',
          isPrimary: true,
        },
        {
          id: 'link-versant-official',
          label: 'official',
          isPrimary: false,
        },
      ],
    })
  })

  it('soft-archives links without hiding active applications', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
    await repository.updateApplicationLink({
      applicationId: 'application-versant-platform',
      linkId: 'link-versant-official',
      archived: true,
    })

    expect(
      await database
        .select()
        .from(applicationLinks)
        .where(eq(applicationLinks.id, 'link-versant-official'))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      deletedAt: expect.any(String),
      isPrimary: false,
    })
    await expect(repository.getApplication('application-versant-platform')).resolves.toMatchObject({
      id: 'application-versant-platform',
      primaryLink: null,
    })
  })

  it('rejects duplicate official URLs on link update after canonicalization', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)

    await expect(
      repository.updateApplicationLink({
        applicationId: 'application-versant-platform',
        linkId: 'link-versant-official',
        url: 'https://jobs.example.test/remediated/f60a3102c158cd7c?gh_src=abc&utm_source=agent',
      }),
    ).rejects.toThrow('Duplicate application official URL')
  })

  it('rejects duplicate official URLs on link creation after canonicalization', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)

    await expect(
      repository.createApplicationLink({
        applicationId: 'application-versant-platform',
        kind: 'official',
        label: 'official',
        url: 'https://jobs.example.test/remediated/f60a3102c158cd7c?gh_src=abc',
      }),
    ).rejects.toThrow('Duplicate application official URL')
  })

  it('archives applications and hides them from application and queue reads', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
    await repository.archiveApplication({
      applicationId: 'application-versant-platform',
      note: 'Duplicate tracker row.',
    })

    expect(
      await database
        .select()
        .from(applications)
        .where(eq(applications.id, 'application-versant-platform'))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      deletedAt: expect.any(String),
    })
    await expect(repository.getApplication('application-versant-platform')).resolves.toBeNull()
    await expect(repository.listApplications()).resolves.toMatchObject({
      total: 2,
      items: expect.not.arrayContaining([
        expect.objectContaining({ id: 'application-versant-platform' }),
      ]),
    })

    expect(
      await database
        .select()
        .from(applicationEvents)
        .where(eq(applicationEvents.applicationId, 'application-versant-platform'))
        ,
    ).toEqual([
      expect.objectContaining({
        type: 'application_archived',
        message: 'Duplicate tracker row.',
      }),
    ])
  })

  it('rejects blank archive notes when provided', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)

    await expect(
      repository.archiveApplication({
        applicationId: 'application-versant-platform',
        note: '   ',
      }),
    ).rejects.toThrow('archive note is required')
    expect(
      await database
        .select()
        .from(applications)
        .where(eq(applications.id, 'application-versant-platform'))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      deletedAt: null,
    })
  })

  it('allows only one concurrent active official link for a URL', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)
    const repository = createPgliteApplicationRepository(database)
    const url = 'https://jobs.example.com/concurrent/official'
    const results = await Promise.allSettled([
      repository.createApplicationLink({
        applicationId: 'application-versant-platform',
        kind: 'official',
        label: 'official',
        url,
      }),
      repository.createApplicationLink({
        applicationId: 'application-jobster-analytics',
        kind: 'official',
        label: 'official',
        url,
      }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

})
