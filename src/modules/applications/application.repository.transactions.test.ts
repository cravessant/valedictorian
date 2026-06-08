import {
  applicationLinks,
  applicationWorkflowStates,
  applications,
  companies,
  sources,
} from '../../db/schema'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { seedSampleApplications } from './application.fixtures'
import { createSqliteApplicationRepository } from './application.repository'

describe('SQLite application repository transaction rollback behavior', () => {
  it('rolls back create rows when a later audit event write fails', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    sqlite
      .prepare(
        `
          create trigger fail_application_events
          before insert on application_events
          begin
            select raise(abort, 'event insert failed');
          end
        `,
      )
      .run()

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
          url: 'https://jobs.example.com/delta/rollback',
        },
      }),
    ).rejects.toThrow('event insert failed')
    expect(database.select().from(companies).all()).toHaveLength(0)
    expect(database.select().from(sources).all()).toHaveLength(0)
    expect(database.select().from(applications).all()).toHaveLength(0)
    expect(database.select().from(applicationLinks).all()).toHaveLength(0)
  })

  it('rolls back status updates when a later audit event write fails', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)
    sqlite
      .prepare(
        `
          create trigger fail_application_events
          before insert on application_events
          begin
            select raise(abort, 'event insert failed');
          end
        `,
      )
      .run()

    const repository = createSqliteApplicationRepository(database)

    await expect(
      repository.updateApplicationStatus({
        applicationId: 'application-versant-platform',
        status: 'submitted',
      }),
    ).rejects.toThrow('event insert failed')
    expect(
      database
        .select()
        .from(applications)
        .where(eq(applications.id, 'application-versant-platform'))
        .get(),
    ).toMatchObject({
      status: 'queued',
    })
  })

  it('rolls back remaining multi-row mutations when audit event writes fail', async () => {
    function setupFailingEventDatabase() {
      const sqlite = createInMemoryDatabase()
      migrateDatabase(sqlite)
      const database = createDrizzleDatabase(sqlite)
      seedSampleApplications(database)
      sqlite
        .prepare(
          `
            create trigger fail_application_events
            before insert on application_events
            begin
              select raise(abort, 'event insert failed');
            end
          `,
        )
        .run()

      return {
        database,
        repository: createSqliteApplicationRepository(database),
      }
    }

    const noteCase = setupFailingEventDatabase()
    await expect(
      noteCase.repository.appendApplicationNote({
        applicationId: 'application-versant-platform',
        message: 'Should roll back.',
      }),
    ).rejects.toThrow('event insert failed')
    expect(
      noteCase.database
        .select()
        .from(applications)
        .where(eq(applications.id, 'application-versant-platform'))
        .get(),
    ).toMatchObject({
      notes: 'Remote paid platform-engineering sample row.',
    })

    const metadataCase = setupFailingEventDatabase()
    await expect(
      metadataCase.repository.updateApplication({
        applicationId: 'application-versant-platform',
        roleTitle: 'Should roll back.',
      }),
    ).rejects.toThrow('event insert failed')
    expect(
      metadataCase.database
        .select()
        .from(applications)
        .where(eq(applications.id, 'application-versant-platform'))
        .get(),
    ).toMatchObject({
      roleTitle: 'Academic Year Internships: Platform Engineering',
    })

    const workflowCase = setupFailingEventDatabase()
    await expect(
      workflowCase.repository.updateApplicationWorkflow({
        applicationId: 'application-versant-platform',
        missingUserInfo: 'Should roll back.',
      }),
    ).rejects.toThrow('event insert failed')
    expect(workflowCase.database.select().from(applicationWorkflowStates).all()).toHaveLength(0)

    const linkCase = setupFailingEventDatabase()
    await expect(
      linkCase.repository.createApplicationLink({
        applicationId: 'application-versant-platform',
        kind: 'source',
        label: 'LinkedIn',
        url: 'https://www.linkedin.com/jobs/view/rollback',
      }),
    ).rejects.toThrow('event insert failed')
    expect(
      linkCase.database
        .select()
        .from(applicationLinks)
        .where(eq(applicationLinks.applicationId, 'application-versant-platform'))
        .all(),
    ).toHaveLength(1)

    const archiveCase = setupFailingEventDatabase()
    await expect(
      archiveCase.repository.archiveApplication({
        applicationId: 'application-versant-platform',
      }),
    ).rejects.toThrow('event insert failed')
    expect(
      archiveCase.database
        .select()
        .from(applications)
        .where(eq(applications.id, 'application-versant-platform'))
        .get(),
    ).toMatchObject({
      deletedAt: null,
    })
  })

})
