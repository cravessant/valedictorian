import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { applicationLinks, applicationScores, applications } from '../../db/schema'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { seedSampleApplications } from './application.fixtures'

describe('sample applications seed', () => {
  it('creates sample tracker applications with links and scores', () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)

    seedSampleApplications(database)

    const rows = database.select().from(applications).all()
    const links = database.select().from(applicationLinks).all()
    const scores = database.select().from(applicationScores).all()

    expect(rows).toHaveLength(3)
    expect(links).toHaveLength(3)
    expect(scores).toHaveLength(3)
    expect(rows.map((row) => row.status)).toEqual(
      expect.arrayContaining(['needs_user_info', 'queued', 'not_fit']),
    )
    expect(
      database.select().from(applicationScores).where(eq(applicationScores.score, 8)).get(),
    ).toBeDefined()
  })
})
