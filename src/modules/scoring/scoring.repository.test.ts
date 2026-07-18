import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  applicationScores,
  applications,
  companies,
  sources,
} from '../../db/schema'
import {
  createPgliteClient,
  migratePgliteDatabase,
  type PgliteClient,
  type PgliteDatabase,
} from '../../db/pglite'
import { createPgliteScoringRepository } from './scoring.repository'

const scoreInput = {
  applicationId: 'application-score-target',
  score: 8,
  band: 'strong',
  roleRelevance: 3,
  careerSignal: 2,
  cityWorkMode: 2,
  compensationLogistics: 1,
  penalties: [{ code: 'none', points: 0 }],
  rationale: 'Strong match for the role.',
  rubricVersion: 'v1',
} as const

async function openMigratedScoringDb() {
  const client = await createPgliteClient()
  const database = await migratePgliteDatabase(client)
  return {
    client,
    database,
    repository: createPgliteScoringRepository(database),
  }
}

async function closeClient(client: PgliteClient) {
  await client.close()
}

async function seedScorableApplication(database: PgliteDatabase) {
  const now = '2026-06-08T12:00:00.000Z'
  await database.insert(companies).values({
    id: 'company-score',
    name: 'Score Co',
    normalizedName: 'score co',
    websiteUrl: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  await database.insert(sources).values({
    id: 'source-score',
    name: 'LinkedIn',
    accountHint: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  await database.insert(applications).values({
    id: 'application-score-target',
    companyId: 'company-score',
    sourceId: 'source-score',
    roleTitle: 'Software Engineer',
    roleKind: 'full_time',
    term: null,
    timingMode: 'unknown',
    termsJson: '[]',
    startDate: null,
    endDate: null,
    city: null,
    region: null,
    country: 'US',
    workMode: 'remote',
    locationRaw: null,
    status: 'queued',
    hasApplied: false,
    currentPriorityScore: null,
    currentPriorityBand: null,
    currentResumeVariant: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
}

describe('PGlite scoring repository', () => {
  it('records a score and updates the application priority atomically', async () => {
    const { client, database, repository } = await openMigratedScoringDb()
    try {
      await seedScorableApplication(database)

      const record = await repository.recordScore({ ...scoreInput, penalties: [...scoreInput.penalties] })

      expect(record).toMatchObject({
        applicationId: scoreInput.applicationId,
        score: 8,
        band: 'strong',
        roleRelevance: 3,
        careerSignal: 2,
        cityWorkMode: 2,
        compensationLogistics: 1,
        rationale: scoreInput.rationale,
        rubricVersion: 'v1',
      })
      expect(record.id).toEqual(expect.any(String))
      expect(record.createdAt).toEqual(expect.any(String))
      expect(record.penalties).toEqual([{ code: 'none', points: 0 }])

      const scores = await database.select().from(applicationScores)
      expect(scores).toHaveLength(1)
      expect(scores[0]).toMatchObject({
        id: record.id,
        applicationId: scoreInput.applicationId,
        score: 8,
        band: 'strong',
        penaltiesJson: JSON.stringify([{ code: 'none', points: 0 }]),
      })

      const [application] = await database
        .select()
        .from(applications)
        .where(eq(applications.id, scoreInput.applicationId))
      expect(application).toMatchObject({
        currentPriorityScore: 8,
        currentPriorityBand: 'strong',
        updatedAt: record.createdAt,
      })
    } finally {
      await closeClient(client)
    }
  })

  it('rolls back the score insert when the application update fails', async () => {
    const { client, database, repository } = await openMigratedScoringDb()
    try {
      await seedScorableApplication(database)
      await client.exec(`
        create or replace function fail_application_update() returns trigger as $$
        begin
          raise exception 'application update failed';
        end;
        $$ language plpgsql;

        create trigger fail_applications_update
        before update on applications
        for each row execute function fail_application_update();
      `)

      let thrown: unknown
      try {
        await repository.recordScore({ ...scoreInput, penalties: [...scoreInput.penalties] })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(Error)
      expect(String(thrown)).toMatch(/Failed query: update "applications"/)
      expect(
        thrown instanceof Error && 'cause' in thrown ? String((thrown as Error & { cause?: unknown }).cause) : '',
      ).toMatch(/application update failed/)

      expect(await database.select().from(applicationScores)).toHaveLength(0)
      const [application] = await database
        .select()
        .from(applications)
        .where(eq(applications.id, scoreInput.applicationId))
      expect(application).toMatchObject({
        currentPriorityScore: null,
        currentPriorityBand: null,
      })
    } finally {
      await closeClient(client)
    }
  })
})
