import { sql } from 'drizzle-orm'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  applicationLinks,
  applicationWorkflowStates,
  applications,
  companies,
  sources,
} from '../../db/schema'
import {
  createPgliteClient,
  migratePgliteDatabase,
  type PgliteDatabase,
} from '../../db/pglite'
import { seedSampleApplications } from './application.fixtures'
import { createPgliteApplicationRepository } from './application.repository'

async function createTestDatabase() {
  const client = await createPgliteClient()
  onTestFinished(() => client.close())
  return migratePgliteDatabase(client)
}

async function installFailingEventTrigger(database: PgliteDatabase) {
  await database.execute(sql.raw(`
    CREATE FUNCTION fail_application_event_insert() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'event insert failed';
    END;
    $$;
  `))
  await database.execute(sql.raw(`
    CREATE TRIGGER fail_application_events
      BEFORE INSERT ON application_events
      FOR EACH ROW EXECUTE FUNCTION fail_application_event_insert();
  `))
}

async function setupFailingEventDatabase() {
  const database = await createTestDatabase()
  await seedSampleApplications(database)
  await installFailingEventTrigger(database)
  return {
    database,
    repository: createPgliteApplicationRepository(database),
  }
}

describe('PGlite application repository transaction rollback behavior', () => {
  it('rolls back create rows when a later audit event write fails', async () => {
    const database = await createTestDatabase()
    await installFailingEventTrigger(database)
    const repository = createPgliteApplicationRepository(database)

    await expect(repository.createApplication({
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
    })).rejects.toThrow('Failed query: insert into "application_events"')

    expect(await database.select().from(companies)).toHaveLength(0)
    expect(await database.select().from(sources)).toHaveLength(0)
    expect(await database.select().from(applications)).toHaveLength(0)
    expect(await database.select().from(applicationLinks)).toHaveLength(0)
  })

  it('rolls back status updates when a later audit event write fails', async () => {
    const { repository } = await setupFailingEventDatabase()

    await expect(repository.updateApplicationStatus({
      applicationId: 'application-versant-platform',
      status: 'submitted',
    })).rejects.toThrow('Failed query: insert into "application_events"')

    await expect(repository.getApplication('application-versant-platform')).resolves.toMatchObject({
      status: 'queued',
    })
  })

  it('rolls back remaining multi-row mutations when audit event writes fail', async () => {
    const noteCase = await setupFailingEventDatabase()
    await expect(noteCase.repository.appendApplicationNote({
      applicationId: 'application-versant-platform',
      message: 'Should roll back.',
    })).rejects.toThrow('Failed query: insert into "application_events"')
    await expect(noteCase.repository.getApplication('application-versant-platform')).resolves.toMatchObject({
      notes: 'Remote paid platform-engineering sample row.',
    })

    const metadataCase = await setupFailingEventDatabase()
    await expect(metadataCase.repository.updateApplication({
      applicationId: 'application-versant-platform',
      roleTitle: 'Should roll back.',
    })).rejects.toThrow('Failed query: insert into "application_events"')
    await expect(metadataCase.repository.getApplication('application-versant-platform')).resolves.toMatchObject({
      roleTitle: 'Academic Year Internships: Platform Engineering',
    })

    const workflowCase = await setupFailingEventDatabase()
    await expect(workflowCase.repository.updateApplicationWorkflow({
      applicationId: 'application-versant-platform',
      missingUserInfo: 'Should roll back.',
    })).rejects.toThrow('Failed query: insert into "application_events"')
    expect(await workflowCase.database.select().from(applicationWorkflowStates)).toHaveLength(0)

    const linkCase = await setupFailingEventDatabase()
    await expect(linkCase.repository.createApplicationLink({
      applicationId: 'application-versant-platform',
      kind: 'source',
      label: 'LinkedIn',
      url: 'https://www.linkedin.com/jobs/view/rollback',
    })).rejects.toThrow('Failed query: insert into "application_events"')
    expect(await linkCase.database.select().from(applicationLinks)).toHaveLength(3)

    const archiveCase = await setupFailingEventDatabase()
    await expect(archiveCase.repository.archiveApplication({
      applicationId: 'application-versant-platform',
    })).rejects.toThrow('Failed query: insert into "application_events"')
    await expect(archiveCase.repository.getApplication('application-versant-platform')).resolves.toMatchObject({
      id: 'application-versant-platform',
    })
  })
})
