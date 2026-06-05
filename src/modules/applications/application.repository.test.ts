import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { applications } from '../../db/schema'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { seedSampleApplications } from './application.fixtures'
import { createSqliteApplicationRepository } from './application.repository'

describe('SQLite application repository', () => {
  it('lists table-ready application rows ordered by priority score', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteApplicationRepository(database)
    const result = await repository.listApplications()
    const rows = result.items

    expect(result).toMatchObject({
      total: 3,
      limit: 50,
      offset: 0,
      hasMore: false,
    })
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      companyName: 'Astranis Space Technologies',
      roleTitle: 'Software Engineer- Backend Intern (Fall 2026)',
      sourceName: 'LinkedIn',
      status: 'needs_user_info',
      currentPriorityScore: 8,
      currentPriorityBand: 'high',
      primaryLink: {
        label: 'official',
        url: 'https://jobs.example.test/remediated/f60a3102c158cd7c',
      },
    })
    expect(rows.map((row) => row.currentPriorityScore)).toEqual([8, 6, 3])
  })

  it('sorts application rows by company name ascending', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteApplicationRepository(database)
    const result = await repository.listApplications({ sort: 'company_asc' })

    expect(result.items.map((row) => row.companyName)).toEqual([
      'Astranis Space Technologies',
      'Jobster',
      'Versant Media',
    ])
  })

  it('sorts application rows by supported list sort keys', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    database
      .update(applications)
      .set({ updatedAt: '2026-06-04T16:02:00.000Z' })
      .where(eq(applications.id, 'application-astranis-backend'))
      .run()
    database
      .update(applications)
      .set({ updatedAt: '2026-06-04T16:01:00.000Z' })
      .where(eq(applications.id, 'application-versant-platform'))
      .run()
    database
      .update(applications)
      .set({ updatedAt: '2026-06-04T16:00:00.000Z' })
      .where(eq(applications.id, 'application-jobster-analytics'))
      .run()

    const repository = createSqliteApplicationRepository(database)

    await expect(repository.listApplications({ sort: 'company_desc' })).resolves.toMatchObject({
      items: [
        { companyName: 'Versant Media' },
        { companyName: 'Jobster' },
        { companyName: 'Astranis Space Technologies' },
      ],
    })
    await expect(repository.listApplications({ sort: 'role_asc' })).resolves.toMatchObject({
      items: [
        { roleTitle: 'Academic Year Internships: Platform Engineering' },
        { roleTitle: 'Business Analytics Intern - Studentjob.ch' },
        { roleTitle: 'Software Engineer- Backend Intern (Fall 2026)' },
      ],
    })
    await expect(repository.listApplications({ sort: 'role_desc' })).resolves.toMatchObject({
      items: [
        { roleTitle: 'Software Engineer- Backend Intern (Fall 2026)' },
        { roleTitle: 'Business Analytics Intern - Studentjob.ch' },
        { roleTitle: 'Academic Year Internships: Platform Engineering' },
      ],
    })
    await expect(repository.listApplications({ sort: 'source_asc' })).resolves.toMatchObject({
      items: [
        { sourceName: 'Jobright' },
        { sourceName: 'LinkedIn' },
        { sourceName: 'LinkedIn' },
      ],
    })
    await expect(repository.listApplications({ sort: 'source_desc' })).resolves.toMatchObject({
      items: [
        { sourceName: 'LinkedIn' },
        { sourceName: 'LinkedIn' },
        { sourceName: 'Jobright' },
      ],
    })
    await expect(repository.listApplications({ sort: 'status_asc' })).resolves.toMatchObject({
      items: [
        { status: 'needs_user_info' },
        { status: 'not_fit' },
        { status: 'queued' },
      ],
    })
    await expect(repository.listApplications({ sort: 'status_desc' })).resolves.toMatchObject({
      items: [
        { status: 'queued' },
        { status: 'not_fit' },
        { status: 'needs_user_info' },
      ],
    })
    await expect(repository.listApplications({ sort: 'updated_asc' })).resolves.toMatchObject({
      items: [
        { id: 'application-jobster-analytics' },
        { id: 'application-versant-platform' },
        { id: 'application-astranis-backend' },
      ],
    })
  })

  it('filters by company, role, and broad search text', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteApplicationRepository(database)

    await expect(repository.listApplications({ company: 'astranis' })).resolves.toMatchObject({
      total: 1,
      items: [{ companyName: 'Astranis Space Technologies' }],
    })
    await expect(repository.listApplications({ role: 'analytics' })).resolves.toMatchObject({
      total: 1,
      items: [{ roleTitle: 'Business Analytics Intern - Studentjob.ch' }],
    })
    await expect(repository.listApplications({ search: 'analytics' })).resolves.toMatchObject({
      total: 1,
      items: [{ roleTitle: 'Business Analytics Intern - Studentjob.ch' }],
    })
  })

  it('returns application row timestamps', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    const repository = createSqliteApplicationRepository(database)

    await expect(repository.listApplications({ company: 'astranis' })).resolves.toMatchObject({
      items: [
        {
          createdAt: '2026-06-04T16:00:00.000Z',
          updatedAt: '2026-06-04T16:00:00.000Z',
        },
      ],
    })
  })

  it('filters by created date range', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    database
      .update(applications)
      .set({ createdAt: '2026-06-01T12:00:00.000Z' })
      .where(eq(applications.id, 'application-astranis-backend'))
      .run()
    database
      .update(applications)
      .set({ createdAt: '2026-06-02T12:00:00.000Z' })
      .where(eq(applications.id, 'application-versant-platform'))
      .run()
    database
      .update(applications)
      .set({ createdAt: '2026-06-03T12:00:00.000Z' })
      .where(eq(applications.id, 'application-jobster-analytics'))
      .run()

    const repository = createSqliteApplicationRepository(database)
    const result = await repository.listApplications({
      createdFrom: '2026-06-02T00:00:00.000Z',
      createdTo: '2026-06-02T23:59:59.999Z',
    })

    expect(result.total).toBe(1)
    expect(result.items[0]).toMatchObject({
      id: 'application-versant-platform',
      createdAt: '2026-06-02T12:00:00.000Z',
    })
  })

  it('filters by updated date range', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    seedSampleApplications(database)

    database
      .update(applications)
      .set({ updatedAt: '2026-06-01T12:00:00.000Z' })
      .where(eq(applications.id, 'application-astranis-backend'))
      .run()
    database
      .update(applications)
      .set({ updatedAt: '2026-06-02T12:00:00.000Z' })
      .where(eq(applications.id, 'application-versant-platform'))
      .run()
    database
      .update(applications)
      .set({ updatedAt: '2026-06-03T12:00:00.000Z' })
      .where(eq(applications.id, 'application-jobster-analytics'))
      .run()

    const repository = createSqliteApplicationRepository(database)
    const result = await repository.listApplications({
      updatedFrom: '2026-06-03T00:00:00.000Z',
      updatedTo: '2026-06-03T23:59:59.999Z',
    })

    expect(result.total).toBe(1)
    expect(result.items[0]).toMatchObject({
      id: 'application-jobster-analytics',
      updatedAt: '2026-06-03T12:00:00.000Z',
    })
  })
})
