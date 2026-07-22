import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  applicationScores,
  applications,
} from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'
import { createPgliteTestOwner } from '../../test/pglite-test-owner'
import { seedCanonicalApplication } from '../../test-fixtures/canonical-application.fixture'
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
  const owner = await createPgliteTestOwner()
  return {
    ...owner,
    cleanup: () => owner.close(),
    repository: createPgliteScoringRepository(owner.database),
  }
}

async function seedScorableApplication(database: PgliteDatabase) {
  const now = '2026-06-08T12:00:00.000Z'
  await seedCanonicalApplication(database, {
    id: scoreInput.applicationId, companyName: 'Score Co', roleTitle: 'Software Engineer',
    workMode: 'remote', createdAt: now,
  })
}

describe('PGlite scoring repository', () => {
  it('records an immutable Application-owned score without mutating the aggregate head', async () => {
    const { cleanup, database, repository } = await openMigratedScoringDb()
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
      expect(application).toMatchObject({ status: 'active', revision: 1 })
      expect(application?.updatedAt).not.toBe(record.createdAt)
    } finally {
      await cleanup()
    }
  })

  it('rolls back cleanly when Application-owned score persistence fails', async () => {
    const { cleanup, client, database, repository } = await openMigratedScoringDb()
    try {
      await seedScorableApplication(database)
      await client.exec(`
        create or replace function fail_application_score_insert() returns trigger as $$
        begin
          raise exception 'application score insert failed';
        end;
        $$ language plpgsql;

        create trigger fail_application_scores_insert
        before insert on application_scores
        for each row execute function fail_application_score_insert();
      `)

      let thrown: unknown
      try {
        await repository.recordScore({ ...scoreInput, penalties: [...scoreInput.penalties] })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(Error)
      expect(String(thrown)).toMatch(/Failed query: insert into "application_scores"/)
      expect(
        thrown instanceof Error && 'cause' in thrown ? String((thrown as Error & { cause?: unknown }).cause) : '',
      ).toMatch(/application score insert failed/)

      expect(await database.select().from(applicationScores)).toHaveLength(0)
      const [application] = await database.select().from(applications)
        .where(eq(applications.id, scoreInput.applicationId))
      expect(application).toMatchObject({ status: 'active', revision: 1 })
    } finally {
      await cleanup()
    }
  })
})
