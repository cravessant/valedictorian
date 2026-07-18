import {
  applicationEvents,
  applicationLinks,
  applications,
  companies,
  sources,
} from '../../db/schema'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createPgliteTestDatabase } from '../../test/pglite-test-owner'
import { seedSampleApplications } from './application.fixtures'
import { createPgliteApplicationRepository } from './application.repository'

async function createTestDatabase() {
  return createPgliteTestDatabase()
}

describe('PGlite application repository create and update behavior', () => {
  it('creates applications with reused lookup rows, a primary link, and an audit event', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
    const created = await repository.createApplication({
      companyName: 'Versant Media',
      roleTitle: 'Software Engineer Intern',
      sourceName: 'LinkedIn',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      status: 'queued',
      term: 'Summer 2027 internship',
      locationRaw: 'United States / Remote',
      primaryLink: {
        kind: 'official',
        label: 'official',
        url: 'https://jobs.example.com/versant/software-engineer-intern',
        externalId: 'versant-1',
      },
      initialNote: 'Merged from LinkedIn sourcing.',
    })

    expect(created).toMatchObject({
      companyName: 'Versant Media',
      roleTitle: 'Software Engineer Intern',
      sourceName: 'LinkedIn',
      status: 'queued',
      term: 'Summer 2027 internship',
      terms: [{ season: 'summer', year: 2027 }],
      timingMode: 'terms',
      startDate: null,
      endDate: null,
      location: 'United States / Remote',
      notes: 'Merged from LinkedIn sourcing.',
      primaryLink: {
        label: 'official',
        url: 'https://jobs.example.com/versant/software-engineer-intern',
      },
    })
    expect(await database.select().from(companies).where(eq(companies.name, 'Versant Media'))).toHaveLength(1)
    expect(await database.select().from(sources).where(eq(sources.name, 'LinkedIn'))).toHaveLength(1)
    expect(
      await database.select().from(applicationLinks).where(eq(applicationLinks.applicationId, created.id)),
    ).toHaveLength(1)
    expect(
      await database.select().from(applicationEvents).where(eq(applicationEvents.applicationId, created.id)),
    ).toEqual([
      expect.objectContaining({
        type: 'application_created',
        message: 'Application created.',
      }),
      expect.objectContaining({
        type: 'note',
        message: 'Merged from LinkedIn sourcing.',
      }),
    ])
  })

  it('normalizes application timing across date, term, and unknown modes', async () => {
    const database = await createTestDatabase()

    const repository = createPgliteApplicationRepository(database)
    const created = await repository.createApplication({
      companyName: 'Calendar Labs',
      roleTitle: 'Infrastructure Intern',
      sourceName: 'Greenhouse',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      status: 'queued',
      timingMode: 'dates',
      startDate: '2027-05-15',
      endDate: '2027-10-01',
      primaryLink: {
        kind: 'official',
        label: 'official',
        url: 'https://jobs.example.com/calendar-labs/infrastructure-intern',
      },
    })

    expect(created).toMatchObject({
      term: 'Summer 2027 / Fall 2027',
      terms: [
        { season: 'summer', year: 2027 },
        { season: 'fall', year: 2027 },
      ],
      timingMode: 'dates',
      startDate: '2027-05-15',
      endDate: '2027-10-01',
    })

    const termMode = await repository.updateApplication({
      applicationId: created.id,
      timingMode: 'terms',
      terms: [
        { season: 'fall', year: 2026 },
        { season: 'summer', year: 2026 },
        { season: 'summer', year: 2026 },
      ],
    })

    expect(termMode).toMatchObject({
      term: 'Summer 2026 / Fall 2026',
      terms: [
        { season: 'summer', year: 2026 },
        { season: 'fall', year: 2026 },
      ],
      timingMode: 'terms',
      startDate: null,
      endDate: null,
    })

    const unknownMode = await repository.updateApplication({
      applicationId: created.id,
      timingMode: 'unknown',
      term: 'Internship',
    })

    expect(unknownMode).toMatchObject({
      term: 'Internship',
      terms: [],
      timingMode: 'unknown',
      startDate: null,
      endDate: null,
    })
  })

  it('rejects mixed application date and term timing input', async () => {
    const database = await createTestDatabase()

    const repository = createPgliteApplicationRepository(database)

    await expect(
      repository.createApplication({
        companyName: 'Mixed Timing Labs',
        roleTitle: 'Software Engineering Intern',
        sourceName: 'LinkedIn',
        roleKind: 'internship',
        country: 'US',
        workMode: 'remote',
        status: 'queued',
        term: 'Summer 2027',
        startDate: '2027-05-01',
        primaryLink: {
          kind: 'official',
          label: 'official',
          url: 'https://jobs.example.com/mixed-timing/software-engineering-intern',
        },
      }),
    ).rejects.toThrow('Date-based timing cannot include term or terms input')
  })

  it('rejects blank required create text fields before writing lookup rows', async () => {
    const database = await createTestDatabase()

    const repository = createPgliteApplicationRepository(database)

    await expect(
      repository.createApplication({
        companyName: '   ',
        roleTitle: 'Software Engineer Intern',
        sourceName: 'LinkedIn',
        roleKind: 'internship',
        country: 'US',
        workMode: 'remote',
        status: 'queued',
        primaryLink: {
          kind: 'official',
          label: 'official',
          url: 'https://jobs.example.com/blank-company',
        },
      }),
    ).rejects.toThrow('companyName is required')
    expect(await database.select().from(companies)).toHaveLength(0)
    expect(await database.select().from(sources)).toHaveLength(0)
    expect(await database.select().from(applications)).toHaveLength(0)
  })

  it('rejects invalid mutation enum values', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
    const validCreateInput = {
      companyName: 'Delta Labs',
      roleTitle: 'Software Engineering Intern',
      sourceName: 'LinkedIn',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      status: 'queued',
      primaryLink: {
        kind: 'official',
        label: 'official',
        url: 'https://jobs.example.com/delta/valid',
      },
    } as const

    await expect(
      repository.createApplication({
        ...validCreateInput,
        roleKind: 'intern',
      } as never),
    ).rejects.toThrow('Invalid roleKind: intern')
    await expect(
      repository.createApplication({
        ...validCreateInput,
        workMode: 'distributed',
      } as never),
    ).rejects.toThrow('Invalid workMode: distributed')
    await expect(
      repository.createApplication({
        ...validCreateInput,
        status: 'todo',
      } as never),
    ).rejects.toThrow('Invalid application status: todo')
    await expect(
      repository.updateApplicationWorkflow({
        applicationId: 'application-versant-platform',
        manualReviewKind: 'manual',
      } as never),
    ).rejects.toThrow('Invalid manualReviewKind: manual')
  })

  it('rejects application creation without a primary or source link', async () => {
    const database = await createTestDatabase()

    const repository = createPgliteApplicationRepository(database)

    await expect(
      repository.createApplication({
        companyName: 'Delta Labs',
        roleTitle: 'Software Engineering Intern',
        sourceName: 'LinkedIn',
        roleKind: 'internship',
        country: 'US',
        workMode: 'remote',
        status: 'queued',
      }),
    ).rejects.toThrow('Application creation requires a primaryLink or sourceLink')
    expect(await database.select().from(applications)).toHaveLength(0)
  })

  it('canonicalizes stored link URLs and rejects malformed URLs', async () => {
    const database = await createTestDatabase()

    const repository = createPgliteApplicationRepository(database)
    const created = await repository.createApplication({
      companyName: 'Delta Labs',
      roleTitle: 'Software Engineering Intern',
      sourceName: 'LinkedIn',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      status: 'queued',
      primaryLink: {
        kind: 'Official',
        label: 'official',
        url: ' HTTPS://Jobs.Example.com:443/apply?utm_source=agent&b=2&a=1#top ',
      },
    })

    expect(
      await database
        .select()
        .from(applicationLinks)
        .where(eq(applicationLinks.applicationId, created.id))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      kind: 'official',
      url: 'https://jobs.example.com/apply?a=1&b=2',
    })

    await expect(
      repository.createApplication({
        companyName: 'Bad URL Co',
        roleTitle: 'Software Engineering Intern',
        sourceName: 'LinkedIn',
        roleKind: 'internship',
        country: 'US',
        workMode: 'remote',
        status: 'queued',
        primaryLink: {
          kind: 'official',
          label: 'official',
          url: 'ftp://jobs.example.com/apply',
        },
      }),
    ).rejects.toThrow('Invalid application URL: ftp://jobs.example.com/apply')
  })

  it('rejects application creation with a duplicate active official URL', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)

    await expect(
      repository.createApplication({
        companyName: 'Astranis Space Technologies',
        roleTitle: 'Backend Intern Duplicate',
        sourceName: 'LinkedIn',
        roleKind: 'internship',
        country: 'US',
        workMode: 'onsite',
        status: 'queued',
        primaryLink: {
          kind: 'official',
          label: 'official',
          url: 'https://jobs.example.test/remediated/f60a3102c158cd7c',
        },
      }),
    ).rejects.toThrow('Duplicate application official URL')
  })

  it('rejects application creation with a duplicate company-role-source fingerprint', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)

    await expect(
      repository.createApplication({
        companyName: 'versant media',
        roleTitle: 'Academic Year Internships: Platform Engineering',
        sourceName: 'linkedin',
        roleKind: 'internship',
        country: 'US',
        workMode: 'remote',
        status: 'queued',
        primaryLink: {
          kind: 'official',
          label: 'official',
          url: 'https://jobs.example.com/different-versant-role-path',
        },
      }),
    ).rejects.toThrow('Duplicate application fingerprint')
  })

  it('appends note events and updates summary notes', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
    const updated = await repository.appendApplicationNote({
      applicationId: 'application-versant-platform',
      message: 'Reached final review page.',
    })

    expect(updated).toMatchObject({
      id: 'application-versant-platform',
      notes: 'Reached final review page.',
    })
    expect(
      await database
        .select()
        .from(applicationEvents)
        .where(eq(applicationEvents.applicationId, 'application-versant-platform'))
        ,
    ).toEqual([
      expect.objectContaining({
        type: 'note',
        message: 'Reached final review page.',
      }),
    ])
  })

  it('rejects blank note messages', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)

    await expect(
      repository.appendApplicationNote({
        applicationId: 'application-versant-platform',
        message: '   ',
      }),
    ).rejects.toThrow('note message is required')
    await expect(
      repository.updateApplicationStatus({
        applicationId: 'application-versant-platform',
        status: 'submitted',
        notes: '   ',
      }),
    ).rejects.toThrow('note message is required')
  })

  it('rejects blank initial create notes when provided', async () => {
    const database = await createTestDatabase()

    const repository = createPgliteApplicationRepository(database)

    await expect(
      repository.createApplication({
        companyName: 'Delta Labs',
        roleTitle: 'Software Engineering Intern',
        sourceName: 'LinkedIn',
        roleKind: 'internship',
        country: 'US',
        workMode: 'remote',
        status: 'queued',
        primaryLink: {
          kind: 'official',
          label: 'official',
          url: 'https://jobs.example.com/delta/blank-note',
        },
        initialNote: '   ',
      }),
    ).rejects.toThrow('note message is required')
    expect(await database.select().from(applications)).toHaveLength(0)
  })

  it('updates status with audit and note events', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
    const updated = await repository.updateApplicationStatus({
      applicationId: 'application-versant-platform',
      status: 'submitted',
      notes: 'Submitted through agent command.',
    })

    expect(updated).toMatchObject({
      id: 'application-versant-platform',
      notes: 'Submitted through agent command.',
      status: 'submitted',
    })
    expect(
      await database
        .select()
        .from(applicationEvents)
        .where(eq(applicationEvents.applicationId, 'application-versant-platform'))
        ,
    ).toEqual([
      expect.objectContaining({
        type: 'status_updated',
        message: 'Application status updated to submitted.',
      }),
      expect.objectContaining({
        type: 'note',
        message: 'Submitted through agent command.',
      }),
    ])
  })

  it('updates restricted application metadata with an audit event', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)
    const updated = await repository.updateApplication({
      applicationId: 'application-versant-platform',
      roleTitle: 'Platform Engineering Intern',
      locationRaw: 'United States / Remote',
      workMode: 'remote',
      hasApplied: true,
      currentResumeVariant: 'systems_resume',
    })

    expect(updated).toMatchObject({
      id: 'application-versant-platform',
      roleTitle: 'Platform Engineering Intern',
      location: 'United States / Remote',
      workMode: 'remote',
      hasApplied: true,
    })
    expect(
      await database
        .select()
        .from(applications)
        .where(eq(applications.id, 'application-versant-platform'))
        .limit(1).then(([row]) => row),
    ).toMatchObject({
      currentResumeVariant: 'systems_resume',
      hasApplied: true,
      roleTitle: 'Platform Engineering Intern',
    })
    expect(
      await database
        .select()
        .from(applicationEvents)
        .where(eq(applicationEvents.applicationId, 'application-versant-platform'))
        ,
    ).toEqual([
      expect.objectContaining({
        type: 'application_updated',
        message: 'Application metadata updated.',
      }),
    ])
  })

  it('rejects empty metadata, workflow, and link patches', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)

    await expect(
      repository.updateApplication({
        applicationId: 'application-versant-platform',
      }),
    ).rejects.toThrow('Application metadata update requires at least one field')
    await expect(
      repository.updateApplicationWorkflow({
        applicationId: 'application-versant-platform',
      }),
    ).rejects.toThrow('Workflow update requires at least one field')
    await expect(
      repository.updateApplicationLink({
        applicationId: 'application-versant-platform',
        linkId: 'link-versant-official',
      }),
    ).rejects.toThrow('Application link update requires at least one field')
  })

  it('rejects invalid metadata patch values', async () => {
    const database = await createTestDatabase()
    await seedSampleApplications(database)

    const repository = createPgliteApplicationRepository(database)

    await expect(
      repository.updateApplication({
        applicationId: 'application-versant-platform',
        roleTitle: '   ',
      }),
    ).rejects.toThrow('roleTitle is required')
    await expect(
      repository.updateApplication({
        applicationId: 'application-versant-platform',
        roleKind: 'intern',
      } as never),
    ).rejects.toThrow('Invalid roleKind: intern')
    await expect(
      repository.updateApplication({
        applicationId: 'application-versant-platform',
        workMode: 'distributed',
      } as never),
    ).rejects.toThrow('Invalid workMode: distributed')
  })

  it('allows only one concurrent create for the same active fingerprint', async () => {
    const database = await createTestDatabase()
    const repository = createPgliteApplicationRepository(database)
    const input = {
      companyName: 'Concurrency Labs',
      roleTitle: 'Backend Intern',
      sourceName: 'LinkedIn',
      roleKind: 'internship' as const,
      country: 'US',
      workMode: 'remote' as const,
      status: 'queued' as const,
      primaryLink: {
        kind: 'official' as const,
        label: 'official',
        url: 'https://jobs.example.com/concurrency/backend-intern',
      },
    }

    const results = await Promise.allSettled([
      repository.createApplication(input),
      repository.createApplication(input),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    await expect(repository.listApplications()).resolves.toMatchObject({ total: 1 })
  })

})
