import {
  applicationEvents,
  applicationLinks,
  applications,
  companies,
  sources,
} from '../../db/schema'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { seedSampleApplications } from './application.fixtures'
import { createSqliteApplicationRepository } from './application.repository'

describe('SQLite application repository create and update behavior', () => {
  it('creates applications with reused lookup rows, a primary link, and an audit event', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteApplicationRepository(database)
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
      location: 'United States / Remote',
      notes: 'Merged from LinkedIn sourcing.',
      primaryLink: {
        label: 'official',
        url: 'https://jobs.example.com/versant/software-engineer-intern',
      },
    })
    expect(database.select().from(companies).where(eq(companies.name, 'Versant Media')).all()).toHaveLength(1)
    expect(database.select().from(sources).where(eq(sources.name, 'LinkedIn')).all()).toHaveLength(1)
    expect(
      database.select().from(applicationLinks).where(eq(applicationLinks.applicationId, created.id)).all(),
    ).toHaveLength(1)
    expect(
      database.select().from(applicationEvents).where(eq(applicationEvents.applicationId, created.id)).all(),
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

  it('rejects blank required create text fields before writing lookup rows', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)

    const repository = createSqliteApplicationRepository(database)

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
    expect(database.select().from(companies).all()).toHaveLength(0)
    expect(database.select().from(sources).all()).toHaveLength(0)
    expect(database.select().from(applications).all()).toHaveLength(0)
  })

  it('rejects invalid mutation enum values', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteApplicationRepository(database)
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
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)

    const repository = createSqliteApplicationRepository(database)

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
    expect(database.select().from(applications).all()).toHaveLength(0)
  })

  it('canonicalizes stored link URLs and rejects malformed URLs', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)

    const repository = createSqliteApplicationRepository(database)
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
      database
        .select()
        .from(applicationLinks)
        .where(eq(applicationLinks.applicationId, created.id))
        .get(),
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
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteApplicationRepository(database)

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
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteApplicationRepository(database)

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
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteApplicationRepository(database)
    const updated = await repository.appendApplicationNote({
      applicationId: 'application-versant-platform',
      message: 'Reached final review page.',
    })

    expect(updated).toMatchObject({
      id: 'application-versant-platform',
      notes: 'Reached final review page.',
    })
    expect(
      database
        .select()
        .from(applicationEvents)
        .where(eq(applicationEvents.applicationId, 'application-versant-platform'))
        .all(),
    ).toEqual([
      expect.objectContaining({
        type: 'note',
        message: 'Reached final review page.',
      }),
    ])
  })

  it('rejects blank note messages', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteApplicationRepository(database)

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
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)

    const repository = createSqliteApplicationRepository(database)

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
    expect(database.select().from(applications).all()).toHaveLength(0)
  })

  it('updates status with audit and note events', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteApplicationRepository(database)
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
      database
        .select()
        .from(applicationEvents)
        .where(eq(applicationEvents.applicationId, 'application-versant-platform'))
        .all(),
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
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteApplicationRepository(database)
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
      database
        .select()
        .from(applications)
        .where(eq(applications.id, 'application-versant-platform'))
        .get(),
    ).toMatchObject({
      currentResumeVariant: 'systems_resume',
      hasApplied: true,
      roleTitle: 'Platform Engineering Intern',
    })
    expect(
      database
        .select()
        .from(applicationEvents)
        .where(eq(applicationEvents.applicationId, 'application-versant-platform'))
        .all(),
    ).toEqual([
      expect.objectContaining({
        type: 'application_updated',
        message: 'Application metadata updated.',
      }),
    ])
  })

  it('rejects empty metadata, workflow, and link patches', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteApplicationRepository(database)

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
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteApplicationRepository(database)

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

})
